-- FR-019: organisers and admins must give a reason when cancelling a game.
-- The reason is shown to the group as a note from the organiser/admin who wrote it.
--   * games gains cancel_reason, cancel_reason_code, cancelled_at/by and who last wrote the note.
--   * cancel_game() is the only way to cancel; set_game_status() no longer accepts 'cancelled'.
--   * update_cancel_reason() adds or edits the note on a game that is already cancelled
--     (covers games cancelled before this release, which have no reason).
--   * get_game() returns a 'cancellation' object; list_games() returns the reason for the list label.
--   * The activity log keeps the reason (status_cancelled) and edits (cancel_reason_updated).

alter table public.games
  add column cancel_reason      text,
  add column cancel_reason_code text,
  add column cancelled_at       timestamptz,
  add column cancelled_by       uuid references auth.users (id) on delete set null,
  add column cancel_reason_at   timestamptz,
  add column cancel_reason_by   uuid references auth.users (id) on delete set null,
  add constraint games_cancel_reason_len check (cancel_reason is null or char_length(btrim(cancel_reason)) between 3 and 200),
  add constraint games_cancel_reason_code check (cancel_reason_code is null
    or cancel_reason_code in ('rain', 'lightning', 'venue', 'players', 'organiser', 'other')),
  add constraint games_cancel_fields_only_when_cancelled check (status = 'cancelled'
    or (cancel_reason is null and cancel_reason_code is null and cancelled_at is null and cancel_reason_at is null));

-- Existing cancelled games: best-known cancellation time from the audit trail (no reason is invented).
update public.games g set cancelled_at = coalesce((
    select max(a.created_at) from public.audit_events a where a.game_id = g.id and a.action = 'status_cancelled'), g.updated_at),
  cancelled_by = (select a.actor_id from public.audit_events a where a.game_id = g.id and a.action = 'status_cancelled'
                  order by a.created_at desc limit 1)
where g.status = 'cancelled' and g.cancelled_at is null;

-- Shared validation: returns the trimmed reason or raises a stable error code.
create or replace function private.clean_cancel_reason(p_code text, p_reason text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_reason, ''));
begin
  if p_code is null or p_code not in ('rain', 'lightning', 'venue', 'players', 'organiser', 'other') then
    raise exception 'invalid_cancel_reason' using errcode = '22023';
  end if;
  if char_length(v) < 3 then raise exception 'cancel_reason_required' using errcode = '22023'; end if;
  if char_length(v) > 200 then raise exception 'cancel_reason_too_long' using errcode = '22023'; end if;
  return v;
end $$;
revoke all on function private.clean_cancel_reason(text, text) from public, anon, authenticated;

create or replace function public.cancel_game(p_game_id uuid, p_reason_code text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_game public.games; v_reason text;
begin
  v_game := private.lock_game(p_game_id);
  if not private.has_role(v_game.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_game.status = 'cancelled' then raise exception 'game_cancelled' using errcode = 'P0001'; end if;
  v_reason := private.clean_cancel_reason(p_reason_code, p_reason);
  update public.games set status = 'cancelled', cancel_reason = v_reason, cancel_reason_code = p_reason_code,
    cancelled_at = now(), cancelled_by = v_uid, cancel_reason_at = now(), cancel_reason_by = v_uid, updated_at = now()
  where id = p_game_id;
  perform private.audit(v_game.group_id, p_game_id, 'status_cancelled', null,
    jsonb_build_object('reason', v_reason, 'reason_code', p_reason_code));
  return jsonb_build_object('cancelled', true, 'reason', v_reason);
end $$;
revoke all on function public.cancel_game(uuid, text, text) from public, anon;
grant execute on function public.cancel_game(uuid, text, text) to authenticated;

create or replace function public.update_cancel_reason(p_game_id uuid, p_reason_code text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_game public.games; v_reason text;
begin
  v_game := private.lock_game(p_game_id);
  if not private.has_role(v_game.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_game.status <> 'cancelled' then raise exception 'game_not_cancelled' using errcode = 'P0001'; end if;
  v_reason := private.clean_cancel_reason(p_reason_code, p_reason);
  if v_reason is not distinct from v_game.cancel_reason and p_reason_code is not distinct from v_game.cancel_reason_code then
    return jsonb_build_object('changed', false, 'reason', v_reason);
  end if;
  update public.games set cancel_reason = v_reason, cancel_reason_code = p_reason_code,
    cancel_reason_at = now(), cancel_reason_by = v_uid, updated_at = now()
  where id = p_game_id;
  perform private.audit(v_game.group_id, p_game_id, 'cancel_reason_updated', null, jsonb_strip_nulls(jsonb_build_object(
    'reason', v_reason, 'reason_code', p_reason_code,
    'previous_reason', v_game.cancel_reason, 'previous_reason_code', v_game.cancel_reason_code)));
  return jsonb_build_object('changed', true, 'reason', v_reason);
end $$;
revoke all on function public.update_cancel_reason(uuid, text, text) from public, anon;
grant execute on function public.update_cancel_reason(uuid, text, text) to authenticated;

-- Cancelling now requires a reason, so the generic status change only opens and closes registration.
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
  if p_status = 'cancelled' then raise exception 'cancel_reason_required' using errcode = '22023'; end if;
  update public.games set status = p_status, updated_at = now() where id = p_game_id;
  perform private.audit(v_game.group_id, p_game_id, 'status_' || p_status::text);
end;
$$;

-- Note shown to the group: the reason, who wrote it (name and current role in the group) and when.
create or replace function private.cancellation_json(p_game public.games)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_game.status <> 'cancelled' then null else jsonb_build_object(
    'reason', p_game.cancel_reason, 'reason_code', p_game.cancel_reason_code,
    'cancelled_at', p_game.cancelled_at, 'note_at', p_game.cancel_reason_at,
    'edited', exists (select 1 from public.audit_events a where a.game_id = p_game.id
                      and a.action = 'cancel_reason_updated' and a.details ? 'previous_reason'),
    'note_by_name', (select p.display_name from public.profiles p where p.user_id = coalesce(p_game.cancel_reason_by, p_game.cancelled_by)),
    'note_by_role', (select m.role from public.group_members m
                     where m.group_id = p_game.group_id and m.user_id = coalesce(p_game.cancel_reason_by, p_game.cancelled_by)))
  end;
$$;
revoke all on function private.cancellation_json(public.games) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_game(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
             'notes', v_game.notes, 'status', v_game.status, 'updated_at', v_game.updated_at,
             'cancellation', private.cancellation_json(v_game)),
    'group', jsonb_build_object('id', v_group.id, 'name', v_group.name, 'timezone', v_group.timezone),
    'my_role', v_role,
    'me', private.position_of(p_game_id, v_uid),
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'display_name', x.display_name,
               'avatar_path', x.avatar_path, 'joined_at', x.joined_at, 'rank', x.pos,
               'status', case when x.pos <= v_game.capacity then 'playing' else 'waitlist' end,
               'position', case when x.pos <= v_game.capacity then x.pos else x.pos - v_game.capacity end)
             order by x.pos)
      from (select r.user_id, coalesce(p.display_name, 'Player') as display_name, p.avatar_path, r.joined_at,
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
           'cancel_reason', case when g.status = 'cancelled' then g.cancel_reason end,
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

-- Activity log allow-list: cancellation reasons and edits.
create or replace function private.activity_details(p_action text,p_details jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select case p_action
    when 'game_updated' then jsonb_strip_nulls(jsonb_build_object('changes',p_details->'changes',
      'capacity',p_details->'capacity','previous_capacity',p_details->'previous_capacity'))
    when 'game_deleted' then jsonb_strip_nulls(jsonb_build_object('registrations',p_details->'registrations'))
    when 'role_changed' then jsonb_strip_nulls(jsonb_build_object('role',p_details->'role'))
    when 'attendance_changed' then jsonb_strip_nulls(jsonb_build_object('previous',p_details->'previous','status',p_details->'status'))
    when 'group_renamed' then jsonb_strip_nulls(jsonb_build_object('old_name',p_details->'old_name','new_name',p_details->'new_name'))
    when 'promoted' then jsonb_strip_nulls(jsonb_build_object('count',p_details->'count','triggered_by',p_details->'triggered_by'))
    when 'verification_resent' then jsonb_strip_nulls(jsonb_build_object('masked_email',p_details->'masked_email'))
    when 'pending_signup_dismissed' then jsonb_strip_nulls(jsonb_build_object('masked_email',p_details->'masked_email'))
    when 'status_cancelled' then jsonb_strip_nulls(jsonb_build_object('reason',p_details->'reason','reason_code',p_details->'reason_code'))
    when 'cancel_reason_updated' then jsonb_strip_nulls(jsonb_build_object('changes',jsonb_build_object(
      'cancel_reason',jsonb_build_object('before',p_details->'previous_reason','after',p_details->'reason'))))
    else '{}'::jsonb end;
$$;
revoke all on function private.activity_details(text,jsonb) from public,anon,authenticated;
