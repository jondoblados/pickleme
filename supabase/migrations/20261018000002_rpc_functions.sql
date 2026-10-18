-- PickleMe RPC functions. Every signup-changing operation locks the game row (SELECT ... FOR UPDATE)
-- so joins, withdrawals, removals and capacity changes are serialised per game.
-- Errors are raised with stable machine-readable messages that the frontend maps to friendly text.

create or replace function private.audit(p_group uuid, p_game uuid, p_action text,
                                         p_target uuid default null, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (group_id, game_id, actor_id, action, target_user_id, details)
  values (p_group, p_game, auth.uid(), p_action, p_target, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function private.require_uid()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  return v;
end;
$$;

-- Status of one user in one game: playing / waitlist / null.
create or replace function private.position_of(p_game_id uuid, p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with ranked as (
    select r.user_id, row_number() over (order by r.queue_no) as pos
    from public.registrations r
    where r.game_id = p_game_id and r.cancelled_at is null
  )
  select case when x.pos is null then jsonb_build_object('status', null)
              when x.pos <= g.capacity then jsonb_build_object('status', 'playing', 'position', x.pos)
              else jsonb_build_object('status', 'waitlist', 'position', x.pos - g.capacity) end
  from public.games g
  left join ranked x on x.user_id = p_user_id
  where g.id = p_game_id;
$$;

create or replace function private.lock_game(p_game_id uuid)
returns public.games language plpgsql security definer set search_path = '' as $$
declare v public.games;
begin
  select * into v from public.games where id = p_game_id for update;
  if not found then raise exception 'game_not_found' using errcode = 'P0002'; end if;
  return v;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid), private.has_role(uuid, public.member_role[]),
                         private.shares_group(uuid) to authenticated;

-- ======================= Profile / identity =======================

create or replace function public.set_display_name(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_name text := btrim(coalesce(p_name, ''));
begin
  v_name := regexp_replace(v_name, '\s+', ' ', 'g');
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  insert into public.profiles (user_id, display_name) values (v_uid, v_name)
  on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now();
  return jsonb_build_object('user_id', v_uid, 'display_name', v_name);
end;
$$;

create or replace function public.get_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'display_name', (select p.display_name from public.profiles p where p.user_id = auth.uid()),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'role', m.role,
                                          'timezone', g.timezone, 'default_capacity', g.default_capacity)
                       order by g.name)
      from public.group_members m join public.groups g on g.id = m.group_id
      where m.user_id = auth.uid()), '[]'::jsonb));
$$;

-- ======================= Invites / membership =======================

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
  perform private.audit(p_group_id, null, 'invite_created', null, jsonb_build_object('invite_id', v_id));
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp, 'max_uses', p_max_uses);
end;
$$;

create or replace function public.revoke_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_group uuid;
begin
  perform private.require_uid();
  select group_id into v_group from public.group_invites where id = p_invite_id;
  if v_group is null or not private.has_role(v_group, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.group_invites set revoked_at = now() where id = p_invite_id and revoked_at is null;
  perform private.audit(v_group, null, 'invite_revoked', null, jsonb_build_object('invite_id', p_invite_id));
end;
$$;

create or replace function public.redeem_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_inv public.group_invites; v_new boolean;
begin
  select * into v_inv from public.group_invites
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;
  if not found then raise exception 'invite_invalid' using errcode = 'P0002'; end if;
  if exists (select 1 from public.group_members where group_id = v_inv.group_id and user_id = v_uid) then
    return jsonb_build_object('group_id', v_inv.group_id, 'already_member', true);
  end if;
  if v_inv.revoked_at is not null then raise exception 'invite_revoked' using errcode = 'P0001'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite_expired' using errcode = 'P0001'; end if;
  if v_inv.use_count >= v_inv.max_uses then raise exception 'invite_used_up' using errcode = 'P0001'; end if;
  insert into public.group_members (group_id, user_id, role) values (v_inv.group_id, v_uid, 'player')
  on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new then
    update public.group_invites set use_count = use_count + 1 where id = v_inv.id;
    perform private.audit(v_inv.group_id, null, 'member_joined', v_uid, jsonb_build_object('invite_id', v_inv.id));
  end if;
  return jsonb_build_object('group_id', v_inv.group_id, 'already_member', not v_new);
end;
$$;

create or replace function public.list_members(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(p_group_id) then raise exception 'not_member' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', p.display_name,
                                        'role', m.role, 'joined_at', m.joined_at)
                     order by (m.role = 'player'), lower(coalesce(p.display_name, '')))
    from public.group_members m left join public.profiles p on p.user_id = m.user_id
    where m.group_id = p_group_id), '[]'::jsonb);
end;
$$;

create or replace function public.set_member_role(p_group_id uuid, p_user_id uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  if not private.has_role(p_group_id, array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id = v_uid then raise exception 'cannot_change_own_role' using errcode = 'P0001'; end if;
  update public.group_members set role = p_role where group_id = p_group_id and user_id = p_user_id;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  perform private.audit(p_group_id, null, 'role_changed', p_user_id, jsonb_build_object('role', p_role));
end;
$$;

-- ======================= Games (organiser) =======================

create or replace function public.create_game(p_group_id uuid, p_title text, p_starts_at timestamptz,
  p_ends_at timestamptz, p_location text default '', p_capacity int default null, p_notes text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_id uuid; v_cap int;
begin
  if not private.has_role(p_group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ends_at <= p_starts_at then raise exception 'invalid_times' using errcode = '22023'; end if;
  select coalesce(p_capacity, default_capacity) into v_cap from public.groups where id = p_group_id;
  insert into public.games (group_id, title, starts_at, ends_at, location, capacity, notes, created_by)
  values (p_group_id, btrim(p_title), p_starts_at, p_ends_at, btrim(coalesce(p_location, '')), v_cap,
          coalesce(p_notes, ''), v_uid)
  returning id into v_id;
  perform private.audit(p_group_id, v_id, 'game_created');
  return v_id;
end;
$$;

create or replace function public.update_game(p_game_id uuid, p_title text, p_starts_at timestamptz,
  p_ends_at timestamptz, p_location text, p_capacity int, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_game public.games; v_active int; v_before bigint[]; v_promoted int;
begin
  perform private.require_uid();
  v_game := private.lock_game(p_game_id);
  if not private.has_role(v_game.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_game.status = 'cancelled' then raise exception 'game_cancelled' using errcode = 'P0001'; end if;
  if p_ends_at <= p_starts_at then raise exception 'invalid_times' using errcode = '22023'; end if;
  select count(*) into v_active from public.registrations where game_id = p_game_id and cancelled_at is null;
  if p_capacity < least(v_active, v_game.capacity) then
    raise exception 'capacity_below_attendees' using errcode = 'P0001';
  end if;
  v_before := private.attendee_reg_ids(p_game_id);
  update public.games set title = btrim(p_title), starts_at = p_starts_at, ends_at = p_ends_at,
         location = btrim(coalesce(p_location, '')), capacity = p_capacity, notes = coalesce(p_notes, ''),
         updated_at = now()
  where id = p_game_id;
  v_promoted := private.record_promotions(p_game_id, v_before);
  perform private.audit(v_game.group_id, p_game_id, 'game_updated', null,
                        jsonb_build_object('capacity', p_capacity, 'previous_capacity', v_game.capacity));
  return jsonb_build_object('promoted', v_promoted);
end;
$$;

create or replace function public.set_game_status(p_game_id uuid, p_status public.game_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_game public.games;
begin
  perform private.require_uid();
  v_game := private.lock_game(p_game_id);
  if not private.has_role(v_game.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_game.status = 'cancelled' then raise exception 'game_cancelled' using errcode = 'P0001'; end if;
  update public.games set status = p_status, updated_at = now() where id = p_game_id;
  perform private.audit(v_game.group_id, p_game_id, 'status_' || p_status::text);
end;
$$;

-- ======================= Signup (players) =======================

create or replace function public.join_game(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_game public.games;
begin
  v_game := private.lock_game(p_game_id);
  if not private.is_member(v_game.group_id) then raise exception 'not_member' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where user_id = v_uid) then
    raise exception 'display_name_required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.registrations where game_id = p_game_id and user_id = v_uid and cancelled_at is null) then
    return private.position_of(p_game_id, v_uid) || jsonb_build_object('already_registered', true);
  end if;
  if v_game.status = 'cancelled' then raise exception 'game_cancelled' using errcode = 'P0001'; end if;
  if v_game.status = 'closed' then raise exception 'registration_closed' using errcode = 'P0001'; end if;
  if v_game.starts_at <= now() then raise exception 'game_started' using errcode = 'P0001'; end if;
  insert into public.registrations (game_id, user_id, queue_no) values (p_game_id, v_uid, v_game.next_queue_no);
  update public.games set next_queue_no = next_queue_no + 1 where id = p_game_id;
  perform private.audit(v_game.group_id, p_game_id, 'joined', v_uid);
  return private.position_of(p_game_id, v_uid) || jsonb_build_object('already_registered', false);
end;
$$;

create or replace function private.cancel_registration(p_game public.games, p_user_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before bigint[]; v_promoted int;
begin
  if p_game.ends_at <= now() then raise exception 'game_finished' using errcode = 'P0001'; end if;
  v_before := private.attendee_reg_ids(p_game.id);
  update public.registrations
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
   where game_id = p_game.id and user_id = p_user_id and cancelled_at is null;
  if not found then raise exception 'not_registered' using errcode = 'P0002'; end if;
  v_promoted := private.record_promotions(p_game.id, v_before);
  perform private.audit(p_game.group_id, p_game.id, p_reason, p_user_id);
  return jsonb_build_object('cancelled', true, 'promoted', v_promoted);
end;
$$;
revoke all on function private.cancel_registration(public.games, uuid, text) from public, anon, authenticated;

create or replace function public.withdraw_game(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_game public.games;
begin
  v_game := private.lock_game(p_game_id);
  if not private.is_member(v_game.group_id) then raise exception 'not_member' using errcode = '42501'; end if;
  return private.cancel_registration(v_game, v_uid, 'withdrew');
end;
$$;

create or replace function public.remove_registration(p_game_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_game public.games;
begin
  perform private.require_uid();
  v_game := private.lock_game(p_game_id);
  if not private.has_role(v_game.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.cancel_registration(v_game, p_user_id, 'removed');
end;
$$;

-- ======================= Read models =======================

create or replace function public.get_game(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_game public.games; v_group public.groups; v_role public.member_role;
begin
  select * into v_game from public.games where id = p_game_id;
  if not found then raise exception 'game_not_found' using errcode = 'P0002'; end if;
  select role into v_role from public.group_members where group_id = v_game.group_id and user_id = v_uid;
  if v_role is null then raise exception 'not_member' using errcode = '42501'; end if;
  select * into v_group from public.groups where id = v_game.group_id;
  return jsonb_build_object(
    'game', jsonb_build_object('id', v_game.id, 'title', v_game.title, 'starts_at', v_game.starts_at,
             'ends_at', v_game.ends_at, 'location', v_game.location, 'capacity', v_game.capacity,
             'notes', v_game.notes, 'status', v_game.status, 'updated_at', v_game.updated_at),
    'group', jsonb_build_object('id', v_group.id, 'name', v_group.name, 'timezone', v_group.timezone),
    'my_role', v_role,
    'me', private.position_of(p_game_id, v_uid),
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'display_name', x.display_name,
               'joined_at', x.joined_at, 'rank', x.pos,
               'status', case when x.pos <= v_game.capacity then 'playing' else 'waitlist' end,
               'position', case when x.pos <= v_game.capacity then x.pos else x.pos - v_game.capacity end)
             order by x.pos)
      from (select r.user_id, coalesce(p.display_name, 'Player') as display_name, r.joined_at,
                   row_number() over (order by r.queue_no) as pos
            from public.registrations r left join public.profiles p on p.user_id = r.user_id
            where r.game_id = p_game_id and r.cancelled_at is null) x), '[]'::jsonb));
end;
$$;

create or replace function public.list_games(p_include_past boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'group_id', g.group_id, 'group_name', gr.name, 'timezone', gr.timezone,
           'title', g.title, 'starts_at', g.starts_at, 'ends_at', g.ends_at, 'location', g.location,
           'capacity', g.capacity, 'status', g.status,
           'playing', least(c.active, g.capacity), 'waitlist', greatest(c.active - g.capacity, 0),
           'me', private.position_of(g.id, auth.uid()))
         order by g.starts_at), '[]'::jsonb)
  from public.games g
  join public.groups gr on gr.id = g.group_id
  join public.group_members m on m.group_id = g.group_id and m.user_id = auth.uid()
  cross join lateral (select count(*)::int as active from public.registrations r
                      where r.game_id = g.id and r.cancelled_at is null) c
  where case when p_include_past then g.ends_at <= now() and g.ends_at > now() - interval '60 days'
             else g.ends_at > now() end;
$$;

-- ---------- Execute grants: authenticated users only ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('set_display_name','get_me','create_invite','revoke_invite',
             'redeem_invite','list_members','set_member_role','create_game','update_game','set_game_status',
             'join_game','withdraw_game','remove_registration','get_game','list_games')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
