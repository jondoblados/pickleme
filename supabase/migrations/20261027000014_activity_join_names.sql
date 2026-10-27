-- v0.9.1: activity log names for group-link joins, and system-attributed waitlist promotions.
--
-- Cause (verified): redeem_invite ran before the new user had a profile, so the audit
-- trigger stored null actor/target names. IDs were always correct (actor = target = joiner).
-- This migration:
--   1. names future rows when a user saves their first display name (set_display_name);
--   2. records waitlist promotions as system actions, keeping who triggered them in details;
--   3. returns actor_kind (self / member / system) and name origin to the admin log;
--   4. repairs existing rows by stable user ID only (never by name or timestamp).

-- 1. Capture who triggered a system action (for "System (after X ...)" labels).
create or replace function private.capture_audit_context()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_trigger uuid;
begin
  if new.details->>'triggered_by' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_trigger:=(new.details->>'triggered_by')::uuid;
  end if;
  new.event_context:=jsonb_strip_nulls(jsonb_build_object('origin','captured_at_event',
    'actor_ref',new.actor_id::text,'target_ref',new.target_user_id::text,
    'actor_name',(select display_name from public.profiles where user_id=new.actor_id),
    'target_name',(select display_name from public.profiles where user_id=new.target_user_id),
    'triggered_by_ref',v_trigger::text,
    'triggered_by_name',(select display_name from public.profiles where user_id=v_trigger),
    'game_ref',coalesce(new.game_id::text,case when new.action='game_deleted' then new.details->>'game_id' end),
    'game_title',coalesce((select title from public.games where id=new.game_id),case when new.action='game_deleted' then new.details->>'title' end),
    'game_starts_at',coalesce((select starts_at::text from public.games where id=new.game_id),case when new.action='game_deleted' then new.details->>'starts_at' end)));
  return new;
end $$;
revoke all on function private.capture_audit_context() from public,anon,authenticated;

-- 2. Promotions are automatic: no actor; the user whose action freed the spot is kept in details.
create or replace function private.record_promotions(p_game_id uuid, p_before bigint[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_after bigint[] := private.attendee_reg_ids(p_game_id);
  v_count int;
begin
  insert into public.notification_outbox (kind, game_id, user_id, registration_id)
  select 'promoted', r.game_id, r.user_id, r.id
  from public.registrations r
  where r.id = any (v_after) and not (r.id = any (p_before))
  on conflict (kind, registration_id) do nothing;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into public.audit_events (group_id, game_id, actor_id, action, details)
    values (private.game_group(p_game_id), p_game_id, null, 'promoted',
      jsonb_strip_nulls(jsonb_build_object('count', v_count, 'triggered_by', auth.uid())));
  end if;
  return v_count;
end;
$$;
revoke all on function private.record_promotions(uuid, bigint[]) from public, anon, authenticated;

-- 3. First profile save fills in names on that user's earlier unnamed audit rows (by user ID).
create or replace function public.set_display_name(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_name text := btrim(coalesce(p_name, ''));
  v_first boolean;
begin
  v_name := regexp_replace(v_name, '\s+', ' ', 'g');
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  v_first := not exists (select 1 from public.profiles where user_id = v_uid);
  insert into public.profiles (user_id, display_name) values (v_uid, v_name)
  on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now();
  if v_first then
    update public.audit_events set event_context = event_context
      || jsonb_build_object('actor_name', v_name, 'actor_name_origin', 'first_profile_name')
      where event_context->>'actor_ref' = v_uid::text and event_context->>'actor_name' is null;
    update public.audit_events set event_context = event_context
      || jsonb_build_object('target_name', v_name, 'target_name_origin', 'first_profile_name')
      where event_context->>'target_ref' = v_uid::text and event_context->>'target_name' is null;
    update public.audit_events set event_context = event_context
      || jsonb_build_object('triggered_by_name', v_name)
      where event_context->>'triggered_by_ref' = v_uid::text and event_context->>'triggered_by_name' is null;
  end if;
  return jsonb_build_object('user_id', v_uid, 'display_name', v_name);
end;
$$;

-- 4. Admin log: expose who-did-it kind and name origin. Same signature, grants and page shape.
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
      'actor_kind',case when a.event_context->>'actor_ref' is null then 'system'
        when a.event_context->>'actor_ref'=a.event_context->>'target_ref' then 'self' else 'member' end,
      'actor_name_origin',a.event_context->>'actor_name_origin',
      'target_user_id',a.event_context->>'target_ref','target_name',a.event_context->>'target_name',
      'target_name_origin',a.event_context->>'target_name_origin',
      'triggered_by_name',a.event_context->>'triggered_by_name',
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

-- 5. One-off repair, matched by stable user IDs only.
-- 5a. Self-joins recorded before the joiner had a profile. The name is the joiner's
--     current profile name (they may have renamed since), and is labelled as such.
-- 5b. Existing promotions: move the recorded user into details.triggered_by, clear the actor.
do $$
declare v_candidates int; v_repaired int; v_promos int; v_moved int;
begin
  select count(*) into v_candidates from public.audit_events a
    join public.profiles p on p.user_id=a.target_user_id
    where a.action='member_joined' and a.actor_id=a.target_user_id
      and a.event_context->>'actor_ref'=a.actor_id::text and a.event_context->>'target_ref'=a.target_user_id::text
      and a.event_context->>'actor_name' is null and a.event_context->>'target_name' is null;
  update public.audit_events a set event_context=a.event_context||jsonb_build_object(
      'actor_name',p.display_name,'target_name',p.display_name,
      'actor_name_origin','repaired_current_profile','target_name_origin','repaired_current_profile',
      'repaired_at',now())
    from public.profiles p
    where p.user_id=a.target_user_id and a.action='member_joined' and a.actor_id=a.target_user_id
      and a.event_context->>'actor_ref'=a.actor_id::text and a.event_context->>'target_ref'=a.target_user_id::text
      and a.event_context->>'actor_name' is null and a.event_context->>'target_name' is null;
  get diagnostics v_repaired=row_count;
  if v_repaired<>v_candidates then
    raise exception 'join name repair mismatch: % candidates, % updated',v_candidates,v_repaired;
  end if;

  select count(*) into v_promos from public.audit_events where action='promoted' and actor_id is not null;
  update public.audit_events set
      details=details||jsonb_build_object('triggered_by',actor_id),
      event_context=(event_context-'actor_ref'-'actor_name')||jsonb_strip_nulls(jsonb_build_object(
        'triggered_by_ref',event_context->>'actor_ref','triggered_by_name',event_context->>'actor_name',
        'repaired_at',now())),
      actor_id=null
    where action='promoted' and actor_id is not null;
  get diagnostics v_moved=row_count;
  if v_moved<>v_promos then
    raise exception 'promotion repair mismatch: % candidates, % updated',v_promos,v_moved;
  end if;
  raise notice 'repaired % join rows and % promotion rows',v_repaired,v_moved;
end $$;

-- Allow the triggering user through the allow-list for promotions; keep FR-015 cases.
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
    else '{}'::jsonb end;
$$;
revoke all on function private.activity_details(text,jsonb) from public,anon,authenticated;
