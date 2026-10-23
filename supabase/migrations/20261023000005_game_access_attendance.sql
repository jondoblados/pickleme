-- Shared game onboarding and explicit, organiser-only attendance.
create or replace function public.preview_shared_game(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare g public.games; gr public.groups;
begin
  perform private.require_uid();
  select * into g from public.games where id=p_game_id;
  if not found then raise exception 'game_not_found'; end if;
  select * into gr from public.groups where id=g.group_id;
  return jsonb_build_object('id',g.id,'group_id',g.group_id,'title',g.title,
    'group_name',gr.name,'starts_at',g.starts_at,'capacity',g.capacity,
    'can_join',g.status='open' and g.starts_at>now(),
    'member',private.is_member(g.group_id));
end $$;

-- A shared game URL is now an invitation to its group, not a public roster.
-- Membership and registration commit together; a failed join grants no access.
create or replace function public.join_shared_game(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.require_uid(); g public.games; added int; result jsonb;
begin
  g:=private.lock_game(p_game_id);
  if not exists(select 1 from auth.users where id=u and email_confirmed_at is not null) then
    raise exception 'verified_email_required';
  end if;
  if g.status<>'open' or g.starts_at<=now() then raise exception 'registration_closed'; end if;
  insert into public.group_members(group_id,user_id,role) values(g.group_id,u,'player') on conflict do nothing;
  get diagnostics added=row_count;
  result:=public.join_game(p_game_id);
  if added=1 then perform private.audit(g.group_id,g.id,'member_joined_via_game',u); end if;
  return result;
end $$;

create table public.attendance_sessions (
  game_id uuid primary key references public.games(id) on delete cascade,
  captured_at timestamptz not null default now()
);
create table public.game_attendance (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'unmarked' check(status in ('unmarked','present','no_show','excused')),
  marked_at timestamptz,
  marked_by uuid references auth.users(id) on delete set null,
  primary key(game_id,user_id)
);
alter table public.attendance_sessions enable row level security;
alter table public.game_attendance enable row level security;
revoke all on public.attendance_sessions,public.game_attendance from public,anon,authenticated;

-- Existing started games have no reliable capacity-at-start history: do not infer attendance.
insert into public.attendance_sessions(game_id) select id from public.games where starts_at<=now();

-- Freeze the playing list as at start. Post-start withdrawals do not erase it.
create or replace function private.capture_attendance(p_game_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.games; n int;
begin
  g:=private.lock_game(p_game_id);
  if g.starts_at>now() or g.status='cancelled' then return; end if;
  insert into public.attendance_sessions(game_id) values(g.id) on conflict do nothing;
  get diagnostics n=row_count;
  if n=0 then return; end if;
  insert into public.game_attendance(game_id,user_id)
  select g.id,x.user_id from (
    select r.user_id,row_number() over(order by r.queue_no) pos
    from public.registrations r where r.game_id=g.id and r.joined_at<=g.starts_at
      and (r.cancelled_at is null or r.cancelled_at>g.starts_at)
  ) x where x.pos<=g.capacity;
end $$;

-- Return NEW for updates: this trigger must never discard the caller's update.
create or replace function private.capture_before_roster_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='games' then perform private.capture_attendance(old.id);
  else perform private.capture_attendance(old.game_id); end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger attendance_before_game_change before update on public.games
for each row execute function private.capture_before_roster_change();
create trigger attendance_before_registration_change before update on public.registrations
for each row execute function private.capture_before_roster_change();

create or replace function public.get_game_attendance(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  perform private.require_uid();
  g:=private.lock_game(p_game_id);
  if not private.has_role(g.group_id,array['organiser','admin']::public.member_role[]) then raise exception 'forbidden' using errcode='42501'; end if;
  perform private.capture_attendance(g.id);
  return jsonb_build_object('started',g.starts_at<=now(),'ended',g.ends_at<=now(),
    'cancelled',g.status='cancelled','rows',coalesce((
      select jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',coalesce(p.display_name,'Player'),
      'status',a.status,'marked_at',a.marked_at) order by lower(coalesce(p.display_name,'Player')),a.user_id)
      from public.game_attendance a left join public.profiles p on p.user_id=a.user_id
      where a.game_id=g.id),'[]'::jsonb));
end $$;

create or replace function public.mark_game_attendance(p_game_id uuid,p_user_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.require_uid(); g public.games; previous text;
begin
  g:=private.lock_game(p_game_id);
  if not private.has_role(g.group_id,array['organiser','admin']::public.member_role[]) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_status is null or p_status not in ('unmarked','present','no_show','excused') then raise exception 'invalid_attendance_status'; end if;
  if g.status='cancelled' or g.starts_at>now() then raise exception 'attendance_unavailable'; end if;
  if p_status='no_show' and g.ends_at>now() then raise exception 'no_show_after_game_only'; end if;
  perform private.capture_attendance(g.id);
  select status into previous from public.game_attendance where game_id=g.id and user_id=p_user_id;
  if not found then raise exception 'not_expected_player'; end if;
  update public.game_attendance set status=p_status,marked_at=now(),marked_by=u
    where game_id=g.id and user_id=p_user_id;
  perform private.audit(g.group_id,g.id,'attendance_changed',p_user_id,
    jsonb_build_object('previous',previous,'status',p_status));
end $$;

-- Dates use the group's timezone; the end date is inclusive.
create or replace function public.attendance_report(p_group_id uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare tz text;
begin
  perform private.require_uid();
  if not private.has_role(p_group_id,array['organiser','admin']::public.member_role[]) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to<p_from then raise exception 'invalid_date_range'; end if;
  select timezone into tz from public.groups where id=p_group_id;
  return coalesce((select jsonb_agg(jsonb_build_object('game_id',g.id,'game',g.title,
    'starts_at',g.starts_at,'user_id',a.user_id,'name',coalesce(p.display_name,'Player'),
    'status',a.status,'marked_at',a.marked_at) order by g.starts_at,a.user_id)
    from public.game_attendance a join public.games g on g.id=a.game_id
    left join public.profiles p on p.user_id=a.user_id
    where g.group_id=p_group_id and g.status<>'cancelled'
    and (g.starts_at at time zone tz)::date between p_from and p_to),'[]'::jsonb);
end $$;
revoke all on function private.capture_attendance(uuid),private.capture_before_roster_change() from public,anon,authenticated;
revoke all on function public.preview_shared_game(uuid),public.join_shared_game(uuid),
  public.get_game_attendance(uuid),public.mark_game_attendance(uuid,uuid,text),
  public.attendance_report(uuid,date,date) from public,anon;
grant execute on function public.preview_shared_game(uuid),public.join_shared_game(uuid),
  public.get_game_attendance(uuid),public.mark_game_attendance(uuid,uuid,text),
  public.attendance_report(uuid,date,date) to authenticated;
