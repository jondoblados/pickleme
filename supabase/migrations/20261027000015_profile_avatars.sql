-- FR-016 (v0.10.0): profile photos, visible only to people who share a group with the owner.
-- Files live in the private `avatars` bucket at <user_id>/<32 hex>.webp|jpg. The browser crops, resizes to
-- 512 px and re-encodes (which strips EXIF/GPS) before upload. Signed URLs are issued per request.

-- 1. Bucket: private, 300 KB, WebP or JPEG only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 307200, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2. Who may read a photo: its owner, or someone sharing a group with the owner.
create or replace function private.can_view_avatar(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_folder text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return v_folder = (select auth.uid())::text or private.shares_group(v_folder::uuid);
end $$;
revoke all on function private.can_view_avatar(text) from public, anon, authenticated;
grant execute on function private.can_view_avatar(text) to authenticated;

-- Owner-only writes into their own folder, one level deep, random hex name. No updates: each upload is a new file.
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{32}\.(webp|jpg)$'));
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy avatars_members_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and private.can_view_avatar(name));

-- 3. Profile reference.
alter table public.profiles add column avatar_path text null, add column avatar_updated_at timestamptz null;

-- 4. Set / clear own photo. Returns the previous path so the client can delete the old file.
create or replace function public.set_avatar(p_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_prev text;
begin
  if p_path is null or p_path !~ ('^' || v_uid::text || '/[0-9a-f]{32}\.(webp|jpg)$') then
    raise exception 'invalid_avatar_path' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = p_path) then
    raise exception 'avatar_not_uploaded' using errcode = 'P0002';
  end if;
  select avatar_path into v_prev from public.profiles where user_id = v_uid for update;
  if not found then raise exception 'profile_required' using errcode = 'P0001'; end if;
  update public.profiles set avatar_path = p_path, avatar_updated_at = now() where user_id = v_uid;
  return jsonb_build_object('avatar_path', p_path, 'previous_path', nullif(v_prev, p_path));
end $$;
create or replace function public.clear_avatar()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_prev text;
begin
  select avatar_path into v_prev from public.profiles where user_id = v_uid for update;
  update public.profiles set avatar_path = null, avatar_updated_at = now() where user_id = v_uid and avatar_path is not null;
  return jsonb_build_object('previous_path', v_prev);
end $$;
revoke all on function public.set_avatar(text), public.clear_avatar() from public, anon;
grant execute on function public.set_avatar(text), public.clear_avatar() to authenticated;

-- 5. Read models gain avatar_path (current photo; names elsewhere keep their own rules).
CREATE OR REPLACE FUNCTION public.get_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v uuid := private.require_uid();
begin
  return jsonb_build_object(
    'user_id', v,
    'display_name', (select p.display_name from public.profiles p where p.user_id = v),
    'avatar_path', (select p.avatar_path from public.profiles p where p.user_id = v),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'role', m.role,
                                          'timezone', g.timezone, 'default_capacity', g.default_capacity)
                       order by g.name)
      from public.group_members m join public.groups g on g.id = m.group_id
      where m.user_id = v), '[]'::jsonb));
end;
$$;
CREATE OR REPLACE FUNCTION public.list_members(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_admin boolean;
begin
  if not private.is_member(p_group_id) then raise exception 'not_member' using errcode = '42501'; end if;
  v_admin := private.has_role(p_group_id, array['admin']::public.member_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', p.display_name,
                                        'avatar_path', p.avatar_path,
                                        'role', m.role, 'joined_at', m.joined_at,
                                        'email_confirmed', case when v_admin then u.email_confirmed_at is not null end)
                     order by (m.role = 'player'), lower(coalesce(p.display_name, '')))
    from public.group_members m
    left join public.profiles p on p.user_id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.group_id = p_group_id), '[]'::jsonb);
end;
$$;
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
             'notes', v_game.notes, 'status', v_game.status, 'updated_at', v_game.updated_at),
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
CREATE OR REPLACE FUNCTION public.list_invites_detail(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
          'name', coalesce(p.display_name, 'Player'), 'avatar_path', p.avatar_path, 'joined_at', a.created_at) order by a.created_at desc, a.id desc)
        from public.audit_events a left join public.profiles p on p.user_id = a.target_user_id
        where a.group_id = p_group_id and a.action = 'member_joined' and a.details->>'invite_id' = i.id::text
      ), '[]'::jsonb)
    ) order by i.created_at desc)
    from public.group_invites i left join public.profiles cp on cp.user_id = i.created_by
    where i.group_id = p_group_id), '[]'::jsonb);
end $$;
CREATE OR REPLACE FUNCTION public.list_game_link_joins(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
begin
  perform private.require_uid();
  if not private.has_role(p_group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', a.target_user_id, 'name', coalesce(p.display_name, 'Player'),
      'avatar_path', p.avatar_path, 'joined_at', a.created_at, 'game_id', a.game_id, 'game', coalesce(g.title, 'Deleted game'),
      'game_starts_at', g.starts_at) order by a.created_at desc, a.id desc)
    from public.audit_events a
    left join public.profiles p on p.user_id = a.target_user_id
    left join public.games g on g.id = a.game_id
    where a.group_id = p_group_id and a.action = 'member_joined_via_game'), '[]'::jsonb);
end $$;
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
      'actor_avatar_path',ap.avatar_path,'target_avatar_path',tp.avatar_path,
      'game_id',a.event_context->>'game_ref','game_title',a.event_context->>'game_title',
      'game_starts_at',a.event_context->>'game_starts_at','context_origin',a.event_context->>'origin',
      'details',private.activity_details(a.action,a.details)) item
    from public.audit_events a
      left join public.profiles ap on ap.user_id=a.actor_id
      left join public.profiles tp on tp.user_id=a.target_user_id
    where a.group_id=p_group_id
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

-- 6. Weekly cleanup of files no profile references (replaced photos the client failed to delete,
--    deleted accounts). Storage files must be removed through the Storage API, so the Edge Function
--    `avatar-cleanup` asks for the list here (shared outbox secret) and deletes with the service role.
create or replace function public.claim_avatar_orphans(p_secret text, p_limit int default 500)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.outbox_secret_ok(p_secret) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(o.name order by o.name) from (
    select so.name from storage.objects so
    where so.bucket_id = 'avatars' and so.created_at < now() - interval '1 day'
      and not exists (select 1 from public.profiles p where p.avatar_path = so.name)
    order by so.name limit least(greatest(coalesce(p_limit, 500), 1), 1000)) o), '[]'::jsonb);
end $$;
revoke all on function public.claim_avatar_orphans(text, int) from public, authenticated;
grant execute on function public.claim_avatar_orphans(text, int) to anon, service_role;

create or replace function private.kick_avatar_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select replace(decrypted_secret, 'send-promotions', 'avatar-cleanup') into v_url
    from vault.decrypted_secrets where name = 'pickleme_send_promotions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'pickleme_outbox_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := v_url, body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-outbox-secret', v_secret),
    timeout_milliseconds := 30000);
end $$;
revoke all on function private.kick_avatar_cleanup() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('pickleme-avatar-cleanup', '17 19 * * 0', 'select private.kick_avatar_cleanup()');
  end if;
end $$;
