-- FR-013 foundation: admin-only reads, stable event context and query API.
-- No frontend release or production application is implied by this migration file.
alter table public.audit_events add column event_context jsonb not null default '{}'::jsonb;
alter table public.audit_events drop constraint audit_events_game_id_fkey;
alter table public.audit_events add constraint audit_events_game_id_fkey
  foreign key (game_id) references public.games(id) on delete set null;

-- Backfill only currently known identity/context; never claim these are historical names.
update public.audit_events a set event_context=jsonb_build_object(
  'origin','backfilled_current','actor_ref',a.actor_id::text,'target_ref',a.target_user_id::text,
  'actor_name',(select display_name from public.profiles where user_id=a.actor_id),
  'target_name',(select display_name from public.profiles where user_id=a.target_user_id),
  'game_ref',coalesce(a.game_id::text,case when a.action='game_deleted' then a.details->>'game_id' end),
  'game_title',coalesce((select title from public.games where id=a.game_id),case when a.action='game_deleted' then a.details->>'title' end),
  'game_starts_at',coalesce((select starts_at::text from public.games where id=a.game_id),case when a.action='game_deleted' then a.details->>'starts_at' end));

create or replace function private.capture_audit_context()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.event_context:=jsonb_build_object('origin','captured_at_event',
    'actor_ref',new.actor_id::text,'target_ref',new.target_user_id::text,
    'actor_name',(select display_name from public.profiles where user_id=new.actor_id),
    'target_name',(select display_name from public.profiles where user_id=new.target_user_id),
    'game_ref',coalesce(new.game_id::text,case when new.action='game_deleted' then new.details->>'game_id' end),
    'game_title',coalesce((select title from public.games where id=new.game_id),case when new.action='game_deleted' then new.details->>'title' end),
    'game_starts_at',coalesce((select starts_at::text from public.games where id=new.game_id),case when new.action='game_deleted' then new.details->>'starts_at' end));
  return new;
end $$;
revoke all on function private.capture_audit_context() from public,anon,authenticated;
create trigger audit_context_before_insert before insert on public.audit_events
for each row execute function private.capture_audit_context();

drop policy audit_events_read on public.audit_events;
create policy audit_events_read on public.audit_events for select to authenticated
  using(private.has_role(group_id,array['admin']::public.member_role[]));
create index audit_events_page_idx on public.audit_events(group_id,created_at desc,id desc);

-- Preserve existing game update validation, row locking and promotion handling.
create or replace function public.update_game(p_game_id uuid,p_title text,p_starts_at timestamptz,
  p_ends_at timestamptz,p_location text,p_capacity int,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.games; active_count int; before_ids bigint[]; promoted_count int;
  before_fields jsonb; after_fields jsonb; changes jsonb;
begin
  perform private.require_uid();
  g:=private.lock_game(p_game_id);
  if not private.has_role(g.group_id,array['organiser','admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if g.status='cancelled' then raise exception 'game_cancelled'; end if;
  if p_ends_at<=p_starts_at then raise exception 'invalid_times' using errcode='22023'; end if;
  select count(*) into active_count from public.registrations where game_id=g.id and cancelled_at is null;
  if p_capacity<least(active_count,g.capacity) then raise exception 'capacity_below_attendees'; end if;
  before_ids:=private.attendee_reg_ids(g.id);
  before_fields:=jsonb_build_object('title',g.title,'starts_at',g.starts_at,'ends_at',g.ends_at,
    'location',g.location,'capacity',g.capacity,'notes',g.notes);
  update public.games set title=btrim(p_title),starts_at=p_starts_at,ends_at=p_ends_at,
    location=btrim(coalesce(p_location,'')),capacity=p_capacity,notes=coalesce(p_notes,''),updated_at=now()
    where id=g.id returning jsonb_build_object('title',title,'starts_at',starts_at,'ends_at',ends_at,
      'location',location,'capacity',capacity,'notes',notes) into after_fields;
  select coalesce(jsonb_object_agg(e.key,jsonb_build_object('before',e.value,'after',after_fields->e.key)),'{}'::jsonb)
    into changes from jsonb_each(before_fields) e where e.value is distinct from after_fields->e.key;
  promoted_count:=private.record_promotions(g.id,before_ids);
  perform private.audit(g.group_id,g.id,'game_updated',null,jsonb_build_object(
    'capacity',p_capacity,'previous_capacity',g.capacity,'changes',changes));
  return jsonb_build_object('promoted',promoted_count);
end $$;
revoke all on function public.update_game(uuid,text,timestamptz,timestamptz,text,int,text) from public,anon;
grant execute on function public.update_game(uuid,text,timestamptz,timestamptz,text,int,text) to authenticated;

-- Returned details are deliberately allow-listed. Never export arbitrary audit JSON/secrets.
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
    else '{}'::jsonb end;
$$;
revoke all on function private.activity_details(text,jsonb) from public,anon,authenticated;

-- Group-local inclusive dates. Keyset pagination uses timestamp + string bigint ID.
-- as_of fixes the upper time boundary for subsequent pages and CSV export.
create or replace function public.list_activity_log(p_group_id uuid,p_from date,p_to date,
  p_game_id uuid default null,p_person_id uuid default null,p_action text default null,
  p_before_at timestamptz default null,p_before_id bigint default null,
  p_limit int default 50,p_as_of timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tz text; start_at timestamptz; end_at timestamptz; as_of_at timestamptz;
  result_rows jsonb; page_rows jsonb; next_cursor jsonb;
begin
  perform private.require_uid();
  if not private.has_role(p_group_id,array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365
    or p_limit is null or p_limit not between 1 and 100
    or ((p_before_at is null)<>(p_before_id is null)) then
    raise exception 'invalid_activity_filters' using errcode='22023';
  end if;
  select timezone into tz from public.groups where id=p_group_id;
  start_at:=p_from::timestamp at time zone tz;
  end_at:=(p_to+1)::timestamp at time zone tz;
  as_of_at:=least(coalesce(p_as_of,statement_timestamp()),statement_timestamp());
  select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id desc),'[]'::jsonb) into result_rows
  from (
    select a.id,a.created_at,jsonb_build_object('id',a.id::text,'created_at',a.created_at,
      'action',a.action,'actor_id',a.event_context->>'actor_ref','actor_name',a.event_context->>'actor_name',
      'target_user_id',a.event_context->>'target_ref','target_name',a.event_context->>'target_name',
      'game_id',a.event_context->>'game_ref','game_title',a.event_context->>'game_title',
      'game_starts_at',a.event_context->>'game_starts_at','context_origin',a.event_context->>'origin',
      'details',private.activity_details(a.action,a.details)) item
    from public.audit_events a where a.group_id=p_group_id
      and a.created_at>=start_at and a.created_at<end_at and a.created_at<=as_of_at
      and (p_game_id is null or a.event_context->>'game_ref'=p_game_id::text)
      and (p_person_id is null or a.event_context->>'actor_ref'=p_person_id::text or a.event_context->>'target_ref'=p_person_id::text)
      and (p_action is null or a.action=p_action)
      and (p_before_at is null or (a.created_at,a.id)<(p_before_at,p_before_id))
    order by a.created_at desc,a.id desc limit p_limit+1
  ) x;
  if jsonb_array_length(result_rows)>p_limit then
    next_cursor:=jsonb_build_object('at',result_rows->(p_limit-1)->'created_at','id',result_rows->(p_limit-1)->'id');
  end if;
  select coalesce(jsonb_agg(e.value order by e.ord),'[]'::jsonb) into page_rows
    from jsonb_array_elements(result_rows) with ordinality e(value,ord) where e.ord<=p_limit;
  return jsonb_build_object('rows',page_rows,'next_cursor',next_cursor,'as_of',as_of_at,'timezone',tz);
end $$;
revoke all on function public.list_activity_log(uuid,date,date,uuid,uuid,text,timestamptz,bigint,int,timestamptz) from public,anon;
grant execute on function public.list_activity_log(uuid,date,date,uuid,uuid,text,timestamptz,bigint,int,timestamptz) to authenticated;
