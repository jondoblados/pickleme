-- Disposable DB only: synthetic filter choices, permissions and timezone boundaries.
begin;
do $$
declare a uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); x uuid:=gen_random_uuid();
  g uuid:=gen_random_uuid(); h uuid:=gen_random_uuid(); game uuid; result jsonb; checks int:=0;
begin
  insert into auth.users(id,email) values(a,'a@options.invalid'),(o,'o@options.invalid'),(p,'p@options.invalid'),(x,'x@options.invalid');
  insert into public.profiles(user_id,display_name) values(a,'Admin'),(o,'Organiser'),(p,'Former member'),(x,'Other admin');
  insert into public.groups(id,name,timezone) values(g,'Options group','Asia/Singapore'),(h,'Other group','Asia/Singapore');
  insert into public.group_members(group_id,user_id,role) values(g,a,'admin'),(g,o,'organiser'),(g,p,'player'),(h,x,'admin');
  perform set_config('request.jwt.claims',json_build_object('sub',a)::text,true);
  game:=public.create_game(g,'Retained game',now()+interval '3 days',now()+interval '3 days 2 hours','Court',16,'');
  insert into public.audit_events(group_id,game_id,actor_id,target_user_id,action,created_at)
    values(g,game,a,p,'test_filter_event','2026-10-25T16:05:00Z');
  result:=public.activity_filter_options(g,'2026-10-26','2026-10-26');
  if (result->'games' @> jsonb_build_array(jsonb_build_object('id',game::text))) is not true then raise exception 'local-day game choice missing';end if;checks:=checks+1;
  if (result->'people' @> jsonb_build_array(jsonb_build_object('id',p::text,'name','Former member'))) is not true then raise exception 'target person missing';end if;checks:=checks+1;
  result:=public.activity_filter_options(g,'2020-01-01','2020-01-01');
  if result is distinct from '{"games":[],"people":[]}'::jsonb then raise exception 'empty-range options wrong';end if;checks:=checks+1;
  perform set_config('request.jwt.claims',json_build_object('sub',p)::text,true);
  begin perform public.activity_filter_options(g,'2026-10-26','2026-10-26');raise exception 'player allowed';
  exception when insufficient_privilege then checks:=checks+1;end;
  perform set_config('request.jwt.claims',json_build_object('sub',a)::text,true);
  perform public.set_game_status(game,'cancelled');perform public.delete_game(game);
  delete from auth.users where id=p;
  result:=public.activity_filter_options(g,'2026-10-26','2026-10-26');
  if (result->'games' @> jsonb_build_array(jsonb_build_object('id',game::text,'name','Retained game'))) is not true then raise exception 'deleted game choice missing';end if;checks:=checks+1;
  if (result->'people' @> jsonb_build_array(jsonb_build_object('id',p::text,'name','Former member'))) is not true then raise exception 'deleted person choice missing';end if;checks:=checks+1;
  perform set_config('request.jwt.claims',json_build_object('sub',o)::text,true);
  begin perform public.activity_filter_options(g,'2026-10-26','2026-10-26');raise exception 'organiser allowed';
  exception when insufficient_privilege then checks:=checks+1;end;
  perform set_config('request.jwt.claims',json_build_object('sub',x)::text,true);
  begin perform public.activity_filter_options(g,'2026-10-26','2026-10-26');raise exception 'cross-group admin allowed';
  exception when insufficient_privilege then checks:=checks+1;end;
  perform set_config('request.jwt.claims',json_build_object('sub',a)::text,true);
  begin perform public.activity_filter_options(g,'2026-10-27','2026-10-26');raise exception 'invalid dates accepted';
  exception when invalid_parameter_value then checks:=checks+1;end;
  set local role anon;
  begin perform public.activity_filter_options(g,'2026-10-26','2026-10-26');raise exception 'anonymous allowed';
  exception when insufficient_privilege then checks:=checks+1;end;
  reset role;
  raise notice 'Filter option assertions passed: %',checks;
end $$;
rollback;
