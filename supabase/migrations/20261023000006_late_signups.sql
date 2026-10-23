-- FR-008: late sign-ups. Players may join a game after it starts (until it ends) while a playing
-- place is free. After the start there is no waitlist: a full in-progress game rejects new sign-ups.
-- Anyone who enters the playing list after the start (late joiner or post-start promotion) is added
-- to attendance as Unmarked and is processed like every other player when the game ends.

create or replace function public.join_game(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_game public.games; v_active int;
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
  if v_game.ends_at <= now() then raise exception 'game_finished' using errcode = 'P0001'; end if;
  if v_game.starts_at <= now() then
    -- Counted under the game row lock, so two people cannot both take the last free place.
    select count(*) into v_active from public.registrations where game_id = p_game_id and cancelled_at is null;
    if v_active >= v_game.capacity then raise exception 'game_full_started' using errcode = 'P0001'; end if;
  end if;
  insert into public.registrations (game_id, user_id, queue_no) values (p_game_id, v_uid, v_game.next_queue_no);
  update public.games set next_queue_no = next_queue_no + 1 where id = p_game_id;
  perform private.audit(v_game.group_id, p_game_id,
    case when v_game.starts_at <= now() then 'joined_late' else 'joined' end, v_uid);
  return private.position_of(p_game_id, v_uid) || jsonb_build_object('already_registered', false);
end;
$$;

-- Status checks now live in join_game (it allows in-progress games with a free place).
create or replace function public.join_shared_game(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.require_uid(); g public.games; added int; result jsonb;
begin
  g:=private.lock_game(p_game_id);
  if not exists(select 1 from auth.users where id=u and email_confirmed_at is not null) then
    raise exception 'verified_email_required' using errcode='42501';
  end if;
  if g.status='cancelled' then raise exception 'game_cancelled'; end if;
  if g.status<>'open' then raise exception 'registration_closed'; end if;
  if g.ends_at<=now() then raise exception 'game_finished'; end if;
  insert into public.group_members(group_id,user_id,role) values(g.group_id,u,'player') on conflict do nothing;
  get diagnostics added=row_count;
  result:=public.join_game(p_game_id); -- raises game_full_started for a full in-progress game; membership rolls back
  if added=1 then perform private.audit(g.group_id,g.id,'member_joined_via_game',u); end if;
  return result;
end $$;

create or replace function public.preview_shared_game(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare g public.games; gr public.groups; active int;
begin
  perform private.require_uid();
  select * into g from public.games where id=p_game_id;
  if not found then raise exception 'game_not_found' using errcode='P0002'; end if;
  select * into gr from public.groups where id=g.group_id;
  select count(*) into active from public.registrations where game_id=g.id and cancelled_at is null;
  return jsonb_build_object('id',g.id,'group_id',g.group_id,'title',g.title,
    'group_name',gr.name,'starts_at',g.starts_at,'ends_at',g.ends_at,'capacity',g.capacity,
    'started',g.starts_at<=now(),
    'can_join',g.status='open' and g.ends_at>now() and (g.starts_at>now() or active<g.capacity),
    'member',private.is_member(g.group_id));
end $$;

-- Add anyone currently on the playing list of an in-progress game to attendance (Unmarked).
-- Existing rows are never changed, so post-start withdrawals stay on the attendance list.
create or replace function private.sync_late_attendance(p_game_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id=p_game_id;
  if not found or g.status='cancelled' or g.starts_at>now() or g.ends_at<=now() then return; end if;
  perform private.capture_attendance(g.id); -- freezes the at-start list first (no-op once captured)
  insert into public.game_attendance(game_id,user_id)
  select g.id,x.user_id from (
    select r.user_id,row_number() over(order by r.queue_no) pos
    from public.registrations r where r.game_id=g.id and r.cancelled_at is null
  ) x where x.pos<=g.capacity
  on conflict do nothing;
end $$;

create or replace function private.sync_late_attendance_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='games' then perform private.sync_late_attendance(new.id);
  else perform private.sync_late_attendance(new.game_id); end if;
  return null;
end $$;

create trigger attendance_after_registration_change after insert or update on public.registrations
for each row execute function private.sync_late_attendance_trigger();
create trigger attendance_after_game_change after update of capacity on public.games
for each row execute function private.sync_late_attendance_trigger();

revoke all on function private.sync_late_attendance(uuid) from public, anon, authenticated;
revoke all on function private.sync_late_attendance_trigger() from public, anon, authenticated;
