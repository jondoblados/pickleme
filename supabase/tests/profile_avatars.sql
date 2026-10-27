-- Integration tests for FR-016 profile photos. Fixtures roll back.
begin;
create or replace function private.outbox_secret_ok(p_secret text) returns boolean language sql as $$ select p_secret = 'test-secret' $$;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); noprof uuid:=gen_random_uuid();
  g1 uuid:=gen_random_uuid(); g2 uuid:=gen_random_uuid(); game uuid; res jsonb; n int; checks int:=0;
  pa text; pa2 text; pb text; today date:=current_date;
begin
  pa:=a||'/'||md5('a1')||'.webp'; pa2:=a||'/'||md5('a2')||'.jpg'; pb:=b||'/'||md5('b1')||'.webp';
  if (select public or file_size_limit<>307200 or allowed_mime_types<>array['image/webp','image/jpeg'] from storage.buckets where id='avatars')
    then raise exception 'bucket settings'; end if; checks:=checks+1;
  insert into auth.users(id,email,aud,role,email_confirmed_at) values (a,'a@fr016.invalid','authenticated','authenticated',now()),
    (b,'b@fr016.invalid','authenticated','authenticated',now()),(c,'c@fr016.invalid','authenticated','authenticated',now()),
    (noprof,'n@fr016.invalid','authenticated','authenticated',now());
  insert into public.profiles(user_id,display_name) values(a,'Alice'),(b,'Bob'),(c,'Carol');
  insert into public.groups(id,name) values(g1,'G1'),(g2,'G2');
  insert into public.group_members(group_id,user_id,role) values(g1,a,'admin'),(g1,b,'player'),(g2,c,'admin');

  -- Writes: own folder only, strict file names
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  insert into storage.objects(bucket_id,name,owner_id) values('avatars',pa,a),('avatars',pa2,a); checks:=checks+1;
  begin insert into storage.objects(bucket_id,name) values('avatars',pb); raise exception 'wrote into another folder';
  exception when insufficient_privilege then checks:=checks+1; end;
  begin insert into storage.objects(bucket_id,name) values('avatars',a||'/sub/'||md5('x')||'.webp'); raise exception 'nested path allowed';
  exception when insufficient_privilege then checks:=checks+1; end;
  begin insert into storage.objects(bucket_id,name) values('avatars',a||'/photo.png'); raise exception 'bad name allowed';
  exception when insufficient_privilege then checks:=checks+1; end;
  perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
  insert into storage.objects(bucket_id,name,owner_id) values('avatars',pb,b);

  -- set_avatar: own existing path only
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  begin perform public.set_avatar(pb); raise exception 'set other user path';
  exception when invalid_parameter_value then checks:=checks+1; end;
  begin perform public.set_avatar(a||'/../'||pb); raise exception 'traversal allowed';
  exception when invalid_parameter_value then checks:=checks+1; end;
  begin perform public.set_avatar(a||'/'||md5('missing')||'.webp'); raise exception 'missing file allowed';
  exception when no_data_found then checks:=checks+1; end;
  res:=public.set_avatar(pa);
  if res->>'avatar_path'<>pa or res->'previous_path'<>'null'::jsonb then raise exception 'set 1 %',res; end if; checks:=checks+1;
  res:=public.set_avatar(pa2);
  if res->>'previous_path'<>pa then raise exception 'set 2 %',res; end if; checks:=checks+1;

  -- Reads: owner and same-group member see it; other group does not
  select count(*) into n from storage.objects where name=pa2; if n<>1 then raise exception 'owner read'; end if; checks:=checks+1;
  perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
  select count(*) into n from storage.objects where name=pa2; if n<>1 then raise exception 'member read'; end if; checks:=checks+1;
  perform set_config('request.jwt.claims',json_build_object('sub',c,'role','authenticated')::text,true);
  select count(*) into n from storage.objects where bucket_id='avatars'; if n<>0 then raise exception 'cross-group read %',n; end if; checks:=checks+1;
  delete from storage.objects where name=pa2; get diagnostics n=row_count; if n<>0 then raise exception 'cross-user delete'; end if; checks:=checks+1;
  perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
  delete from storage.objects where name=pa2; get diagnostics n=row_count; if n<>0 then raise exception 'member delete'; end if; checks:=checks+1;
  -- Anonymous: nothing
  perform set_config('role','anon',true); perform set_config('request.jwt.claims','{}',true);
  begin select count(*) into n from storage.objects; if n<>0 then raise exception 'anon read'; end if;
  exception when insufficient_privilege then null; end; checks:=checks+1;
  perform set_config('role','authenticated',true);

  -- Read models carry the current photo
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  if public.get_me()->>'avatar_path'<>pa2 then raise exception 'get_me'; end if; checks:=checks+1;
  select count(*) into n from jsonb_array_elements(public.list_members(g1)) e where e->>'user_id'=a::text and e->>'avatar_path'=pa2;
  if n<>1 then raise exception 'list_members'; end if; checks:=checks+1;
  game:=public.create_game(g1,'Photo game',now()+interval '1 day',now()+interval '1 day 2 hours','Court',8,null);
  perform public.join_game(game);
  if public.get_game(game)->'roster'->0->>'avatar_path'<>pa2 then raise exception 'roster'; end if; checks:=checks+1;
  perform public.set_member_role(g1,b,'organiser');
  res:=public.list_activity_log(g1,today-1,today+1,null,null,'role_changed');
  if res->'rows'->0->>'actor_avatar_path'<>pa2 or res->'rows'->0->'target_avatar_path'<>'null'::jsonb then raise exception 'activity %',res; end if; checks:=checks+1;

  -- clear_avatar returns the old path for deletion
  res:=public.clear_avatar();
  if res->>'previous_path'<>pa2 or public.get_me()->'avatar_path'<>'null'::jsonb then raise exception 'clear %',res; end if; checks:=checks+1;
  -- No profile yet: set_avatar refuses
  perform set_config('request.jwt.claims',json_build_object('sub',noprof,'role','authenticated')::text,true);
  begin perform public.set_avatar(noprof||'/'||md5('n')||'.webp'); raise exception 'no-profile allowed';
  exception when no_data_found or raise_exception then checks:=checks+1; end;

  -- Orphan list: secret required; only unreferenced files older than a day
  perform set_config('role','postgres',true);
  update storage.objects set created_at=now()-interval '2 days' where bucket_id='avatars';
  update public.profiles set avatar_path=pb where user_id=b;
  begin perform public.claim_avatar_orphans('wrong'); raise exception 'bad secret allowed';
  exception when insufficient_privilege then checks:=checks+1; end;
  res:=public.claim_avatar_orphans('test-secret');
  if res<>jsonb_build_array(pa,pa2) and res<>jsonb_build_array(pa2,pa) then raise exception 'orphans %',res; end if; checks:=checks+1;
  if has_function_privilege('authenticated','public.claim_avatar_orphans(text,int)','execute') then raise exception 'orphans granted to users'; end if; checks:=checks+1;

  raise notice 'profile_avatars: % checks passed',checks;
end $$;
rollback;
