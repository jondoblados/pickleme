-- FR-009: re-copy invite links and see who joined with each link (and from game links).
-- Raw tokens are kept in a private table with no client grants; only organisers/admins can
-- retrieve them through get_invite_link, and only while the link is still usable.
-- Links created before this migration only have a hash, so they cannot be shown again.

create table private.invite_tokens (
  invite_id uuid primary key references public.group_invites(id) on delete cascade,
  token     text not null
);
revoke all on private.invite_tokens from public, anon, authenticated;

create or replace function public.create_invite(p_group_id uuid, p_valid_days int default 30, p_max_uses int default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_token text; v_id uuid; v_exp timestamptz;
begin
  if not private.has_role(p_group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_valid_days not between 1 and 365 or p_max_uses not between 1 and 1000 then
    raise exception 'invalid_invite_settings' using errcode = '22023';
  end if;
  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  v_exp := now() + make_interval(days => p_valid_days);
  insert into public.group_invites (group_id, token_hash, created_by, expires_at, max_uses)
  values (p_group_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_uid, v_exp, p_max_uses)
  returning id into v_id;
  insert into private.invite_tokens (invite_id, token) values (v_id, v_token);
  perform private.audit(p_group_id, null, 'invite_created', null, jsonb_build_object('invite_id', v_id));
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp, 'max_uses', p_max_uses);
end;
$$;

-- Returns the raw token for an active invite. Turned-off, expired and used-up links are not returned.
create or replace function public.get_invite_link(p_invite_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.group_invites; t text;
begin
  perform private.require_uid();
  select * into i from public.group_invites where id = p_invite_id;
  if not found or not private.has_role(i.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.revoked_at is not null or i.expires_at <= now() or i.use_count >= i.max_uses then
    raise exception 'invite_inactive' using errcode = 'P0001';
  end if;
  select token into t from private.invite_tokens where invite_id = i.id;
  if t is null then raise exception 'invite_not_copyable' using errcode = 'P0002'; end if;
  return jsonb_build_object('token', t);
end $$;

-- Invites with creator, copyability and who joined with each (from the existing audit trail).
create or replace function public.list_invites_detail(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_uid();
  if not private.has_role(p_group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'created_at', i.created_at, 'expires_at', i.expires_at, 'max_uses', i.max_uses,
      'use_count', i.use_count, 'revoked_at', i.revoked_at,
      'created_by_name', coalesce(cp.display_name, 'Organiser'),
      'copyable', exists (select 1 from private.invite_tokens t where t.invite_id = i.id),
      'joined', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', a.target_user_id,
          'name', coalesce(p.display_name, 'Player'), 'joined_at', a.created_at) order by a.created_at desc, a.id desc)
        from public.audit_events a left join public.profiles p on p.user_id = a.target_user_id
        where a.group_id = p_group_id and a.action = 'member_joined' and a.details->>'invite_id' = i.id::text
      ), '[]'::jsonb)
    ) order by i.created_at desc)
    from public.group_invites i left join public.profiles cp on cp.user_id = i.created_by
    where i.group_id = p_group_id), '[]'::jsonb);
end $$;

-- Members who joined the group by opening a shared game link.
create or replace function public.list_game_link_joins(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_uid();
  if not private.has_role(p_group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', a.target_user_id, 'name', coalesce(p.display_name, 'Player'),
      'joined_at', a.created_at, 'game_id', a.game_id, 'game', coalesce(g.title, 'Deleted game'),
      'game_starts_at', g.starts_at) order by a.created_at desc, a.id desc)
    from public.audit_events a
    left join public.profiles p on p.user_id = a.target_user_id
    left join public.games g on g.id = a.game_id
    where a.group_id = p_group_id and a.action = 'member_joined_via_game'), '[]'::jsonb);
end $$;

revoke all on function public.get_invite_link(uuid) from public, anon;
revoke all on function public.list_invites_detail(uuid) from public, anon;
revoke all on function public.list_game_link_joins(uuid) from public, anon;
grant execute on function public.get_invite_link(uuid) to authenticated;
grant execute on function public.list_invites_detail(uuid) to authenticated;
grant execute on function public.list_game_link_joins(uuid) to authenticated;
