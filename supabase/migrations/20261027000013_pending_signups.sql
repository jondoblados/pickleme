-- FR-015: admins see people who asked to sign in from their group's game or invite link but have not
-- confirmed their email, and can send a fresh confirmation email (through the admin-resend-verification
-- Edge Function). The browser only ever receives a partly hidden email address.
--
-- Group attribution comes from user metadata that the sign-in screen sends with signInWithOtp:
--   pm_pending_game         uuid of the game link the person opened
--   pm_pending_invite_hash  sha256 hex of the invite token they opened (never the token itself)
-- Supabase stores this metadata only when the account is first created, which is exactly the unconfirmed case.
-- Metadata is user-supplied, so it is validated here and only ever matched against existing games/invites.

create table private.pending_signup_dismissals (
  group_id     uuid not null references public.groups (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  dismissed_by uuid references auth.users (id) on delete set null,
  dismissed_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table private.verification_resends (
  id       bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  sent_by  uuid references auth.users (id) on delete set null,
  sent_at  timestamptz not null default now()
);
create index verification_resends_user_idx on private.verification_resends (user_id, sent_at desc);
revoke all on private.pending_signup_dismissals, private.verification_resends from public, anon, authenticated;

-- "echeong8@yahoo.com.sg" -> "ec•••@yahoo.com.sg"; one-character local parts keep only that character.
create or replace function private.mask_email(p_email text)
returns text language sql immutable set search_path = '' as $$
  select case when p_email is null or position('@' in p_email) = 0 then null
    else left(split_part(p_email, '@', 1), case when char_length(split_part(p_email, '@', 1)) <= 2 then 1 else 2 end)
      || '•••@' || split_part(p_email, '@', 2) end;
$$;

-- Which group (and game) an unconfirmed account came from, or nothing.
create or replace function private.pending_source(p_meta jsonb)
returns table (group_id uuid, game_id uuid, invite_id uuid)
language sql stable security definer set search_path = '' as $$
  select g.group_id, g.id, null::uuid from public.games g
   where (p_meta->>'pm_pending_game') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and g.id = (p_meta->>'pm_pending_game')::uuid
  union all
  select i.group_id, null::uuid, i.id from public.group_invites i
   where (p_meta->>'pm_pending_invite_hash') ~ '^[0-9a-f]{64}$'
     and i.token_hash = p_meta->>'pm_pending_invite_hash'
  limit 1;
$$;

-- Unconfirmed, not deleted, created in the last 30 days, attributed to this group, not dismissed, not a member.
create or replace function private.pending_signups(p_group_id uuid)
returns table (user_id uuid, email text, created_at timestamptz, confirmation_sent_at timestamptz,
               game_id uuid, invite_id uuid)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, u.created_at, u.confirmation_sent_at, s.game_id, s.invite_id
  from auth.users u cross join lateral private.pending_source(u.raw_user_meta_data) s
  where s.group_id = p_group_id
    and u.email_confirmed_at is null and u.deleted_at is null
    and u.created_at > now() - interval '30 days'
    and not exists (select 1 from private.pending_signup_dismissals d where d.group_id = p_group_id and d.user_id = u.id)
    and not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = u.id);
$$;
revoke all on function private.mask_email(text), private.pending_source(jsonb), private.pending_signups(uuid)
  from public, anon, authenticated;

create or replace function public.list_pending_signups(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_uid();
  if not private.has_role(p_group_id, array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', p.user_id,
      'masked_email', private.mask_email(p.email),
      'signed_up_at', p.created_at,
      'last_email_at', greatest(p.confirmation_sent_at, r.last_sent),
      'resend_available_at', case when r.last_sent is null then null else r.last_sent + interval '10 minutes' end,
      'source', case when p.game_id is not null then 'game' else 'invite' end,
      'game_title', g.title, 'game_starts_at', g.starts_at
    ) order by p.created_at desc)
    from (select * from private.pending_signups(p_group_id) order by created_at desc limit 50) p
    left join public.games g on g.id = p.game_id
    left join lateral (select max(v.sent_at) last_sent from private.verification_resends v where v.user_id = p.user_id) r on true
  ), '[]'::jsonb);
end $$;

-- Authorises one resend and records it. Returns where the confirmation link should lead, never the email.
-- The Edge Function calls this with the admin's own JWT, then looks up the address with the service role.
create or replace function public.claim_verification_resend(p_group_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); p record; v_token text;
begin
  if not private.has_role(p_group_id, array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into p from private.pending_signups(p_group_id) s where s.user_id = p_user_id;
  if not found then raise exception 'pending_signup_not_found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('verification_resend:' || p_user_id::text, 0));
  if exists (select 1 from private.verification_resends v
             where v.user_id = p_user_id and v.sent_at > now() - interval '10 minutes') then
    raise exception 'resend_too_soon' using errcode = 'P0001';
  end if;
  insert into private.verification_resends (group_id, user_id, sent_by) values (p_group_id, p_user_id, v_uid);
  perform private.audit(p_group_id, null, 'verification_resent', p_user_id,
    jsonb_build_object('masked_email', private.mask_email(p.email)));
  if p.invite_id is not null then
    select t.token into v_token from private.invite_tokens t join public.group_invites i on i.id = t.invite_id
     where t.invite_id = p.invite_id and i.revoked_at is null and i.expires_at > now() and i.use_count < i.max_uses;
  end if;
  return jsonb_build_object('game_id', p.game_id, 'invite_token', v_token);
end $$;

create or replace function public.dismiss_pending_signup(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); p record;
begin
  if not private.has_role(p_group_id, array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into p from private.pending_signups(p_group_id) s where s.user_id = p_user_id;
  if not found then raise exception 'pending_signup_not_found' using errcode = 'P0002'; end if;
  insert into private.pending_signup_dismissals (group_id, user_id, dismissed_by) values (p_group_id, p_user_id, v_uid)
  on conflict do nothing;
  perform private.audit(p_group_id, null, 'pending_signup_dismissed', p_user_id,
    jsonb_build_object('masked_email', private.mask_email(p.email)));
end $$;

-- Members list: admins also see whether each member's email is confirmed (null for everyone else).
create or replace function public.list_members(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_admin boolean;
begin
  if not private.is_member(p_group_id) then raise exception 'not_member' using errcode = '42501'; end if;
  v_admin := private.has_role(p_group_id, array['admin']::public.member_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', p.display_name,
                                        'role', m.role, 'joined_at', m.joined_at,
                                        'email_confirmed', case when v_admin then u.email_confirmed_at is not null end)
                     order by (m.role = 'player'), lower(coalesce(p.display_name, '')))
    from public.group_members m
    left join public.profiles p on p.user_id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.group_id = p_group_id), '[]'::jsonb);
end;
$$;

-- Activity log: allow the masked address through for the two new admin actions.
create or replace function private.activity_details(p_action text,p_details jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select case p_action
    when 'game_updated' then jsonb_strip_nulls(jsonb_build_object('changes',p_details->'changes',
      'capacity',p_details->'capacity','previous_capacity',p_details->'previous_capacity'))
    when 'game_deleted' then jsonb_strip_nulls(jsonb_build_object('registrations',p_details->'registrations'))
    when 'role_changed' then jsonb_strip_nulls(jsonb_build_object('role',p_details->'role'))
    when 'attendance_changed' then jsonb_strip_nulls(jsonb_build_object('previous',p_details->'previous','status',p_details->'status'))
    when 'group_renamed' then jsonb_strip_nulls(jsonb_build_object('old_name',p_details->'old_name','new_name',p_details->'new_name'))
    when 'promoted' then jsonb_strip_nulls(jsonb_build_object('count',p_details->'count'))
    when 'verification_resent' then jsonb_strip_nulls(jsonb_build_object('masked_email',p_details->'masked_email'))
    when 'pending_signup_dismissed' then jsonb_strip_nulls(jsonb_build_object('masked_email',p_details->'masked_email'))
    else '{}'::jsonb end;
$$;
revoke all on function private.activity_details(text,jsonb) from public,anon,authenticated;

revoke all on function public.list_pending_signups(uuid), public.claim_verification_resend(uuid, uuid),
  public.dismiss_pending_signup(uuid, uuid) from public, anon;
grant execute on function public.list_pending_signups(uuid), public.claim_verification_resend(uuid, uuid),
  public.dismiss_pending_signup(uuid, uuid) to authenticated;
