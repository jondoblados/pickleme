-- Admin-only filter choices include retained deleted games and former members.
create or replace function public.activity_filter_options(p_group_id uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tz text; starts timestamptz; ends timestamptz; games_json jsonb; people_json jsonb;
begin
  perform private.require_uid();
  if not private.has_role(p_group_id,array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then
    raise exception 'invalid_activity_filters' using errcode='22023';
  end if;
  select timezone into tz from public.groups where id=p_group_id;
  starts:=p_from::timestamp at time zone tz;ends:=(p_to+1)::timestamp at time zone tz;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by lower(x.name),x.id),'[]'::jsonb)
  into games_json from (
    select distinct on (a.event_context->>'game_ref') a.event_context->>'game_ref' id,
      coalesce(a.event_context->>'game_title','Unknown game') name
    from public.audit_events a where a.group_id=p_group_id and a.created_at>=starts and a.created_at<ends
      and a.event_context->>'game_ref' is not null
    order by a.event_context->>'game_ref',a.created_at desc,a.id desc
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by lower(x.name),x.id),'[]'::jsonb)
  into people_json from (
    select distinct on (u.ref) u.ref id,coalesce(u.name,'Unknown person') name
    from public.audit_events a cross join lateral (
      values (a.event_context->>'actor_ref',a.event_context->>'actor_name'),
             (a.event_context->>'target_ref',a.event_context->>'target_name')
    ) u(ref,name)
    where a.group_id=p_group_id and a.created_at>=starts and a.created_at<ends and u.ref is not null
    order by u.ref,a.created_at desc,a.id desc
  ) x;
  return jsonb_build_object('games',games_json,'people',people_json);
end $$;
revoke all on function public.activity_filter_options(uuid,date,date) from public,anon;
grant execute on function public.activity_filter_options(uuid,date,date) to authenticated;
