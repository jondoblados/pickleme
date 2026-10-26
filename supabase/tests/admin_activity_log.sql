-- Integration tests for FR-013; run on a disposable DB after the migration.
-- Assertions fail the process; successful fixture writes are rolled back.
begin;
do $$
declare admin uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); player uuid:=gen_random_uuid();
  other_admin uuid:=gen_random_uuid(); grp uuid:=gen_random_uuid(); other_grp uuid:=gen_random_uuid();
  game uuid; inv jsonb; result jsonb; page2 jsonb; saved jsonb; event_count int; checks int:=0;
  starts timestamptz:=now()+interval '2 days'; ends timestamptz:=now()+interval '2 days 2 hours';
begin
  insert into auth.users(id,email,aud,role) values
    (admin,'admin@fr013.invalid','authenticated','authenticated'),(org,'org@fr013.invalid','authenticated','authenticated'),
    (player,'player@fr013.invalid','authenticated','authenticated'),(other_admin,'other@fr013.invalid','authenticated','authenticated');
  insert into public.profiles(user_id,display_name) values(admin,'Admin'),(org,'Organiser'),(player,'Player'),(other_admin,'Other admin');
  insert into public.groups(id,name) values(grp,'FR013 group'),(other_grp,'Other group');
  insert into public.group_members(group_id,user_id,role) values(grp,admin,'admin'),(grp,org,'organiser'),(other_grp,other_admin,'admin');
  perform set_config('request.jwt.claims',json_build_object('sub',admin)::text,true);
  game:=public.create_game(grp,'Test game',starts,ends,'Court A',16,'Old notes');
  inv:=public.create_invite(grp,30,100);
  perform set_config('request.jwt.claims',json_build_object('sub',player)::text,true);
  perform public.redeem_invite(inv->>'token');perform public.join_game(game);perform public.withdraw_game(game);
  perform set_config('request.jwt.claims',json_build_object('sub',org)::text,true);
  perform public.update_game(game,'New title',starts+interval '1 hour',ends+interval '1 hour','Court B',17,'New notes');
  result:=public.list_invites_detail(grp);
  if jsonb_array_length(result->0->'joined') is distinct from 1 then raise exception 'organiser invite-history regression'; end if;checks:=checks+1;
  perform public.list_game_link_joins(grp);checks:=checks+1;
  begin
    perform public.list_activity_log(grp,current_date-1,current_date+1);raise exception 'organiser RPC allowed';
  exception when insufficient_privilege then checks:=checks+1;end;
  set local role authenticated;
  select count(*) into event_count from public.audit_events where group_id=grp;
  if event_count<>0 then raise exception 'organiser raw RLS leak';end if;checks:=checks+1;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',player)::text,true);
  begin
    perform public.list_activity_log(grp,current_date-1,current_date+1);raise exception 'player RPC allowed';
  exception when insufficient_privilege then checks:=checks+1;end;
  set local role authenticated;
  select count(*) into event_count from public.audit_events where group_id=grp;
  if event_count<>0 then raise exception 'player raw RLS leak';end if;checks:=checks+1;
  begin
    insert into public.audit_events(group_id,action) values(grp,'forged');raise exception 'direct audit insert allowed';
  exception when insufficient_privilege then checks:=checks+1;end;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',other_admin)::text,true);
  begin
    perform public.list_activity_log(grp,current_date-1,current_date+1);raise exception 'cross-group RPC allowed';
  exception when insufficient_privilege then checks:=checks+1;end;
  set local role authenticated;
  select count(*) into event_count from public.audit_events where group_id=grp;
  if event_count<>0 then raise exception 'cross-group raw RLS leak';end if;checks:=checks+1;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',admin)::text,true);
  result:=public.list_activity_log(grp,current_date-1,current_date+1,game,null,'game_updated');
  saved:=result->'rows'->0;
  if saved->'details'->'changes'->'title' is distinct from jsonb_build_object('before','Test game','after','New title') then raise exception 'title diff wrong';end if;checks:=checks+1;
  if saved->'details'->'changes'->'location' is distinct from jsonb_build_object('before','Court A','after','Court B') then raise exception 'location diff wrong';end if;checks:=checks+1;
  if saved->'details'->'changes'->'capacity' is distinct from jsonb_build_object('before',16,'after',17) then raise exception 'capacity diff wrong';end if;checks:=checks+1;
  if saved->>'actor_name' is distinct from 'Organiser' then raise exception 'actor attribution wrong';end if;checks:=checks+1;
  result:=public.list_activity_log(grp,current_date-1,current_date+1,null,player,'withdrew');
  if jsonb_array_length(result->'rows')<>1 or result->'rows'->0->>'target_name' is distinct from 'Player' then raise exception 'person/action filter wrong';end if;checks:=checks+1;
  result:=public.list_activity_log(grp,current_date-1,current_date+1,null,null,null,null,null,2);
  if jsonb_array_length(result->'rows')<>2 or result->'next_cursor'='null'::jsonb then raise exception 'pagination page 1 wrong';end if;checks:=checks+1;
  page2:=public.list_activity_log(grp,current_date-1,current_date+1,null,null,null,
    (result->'next_cursor'->>'at')::timestamptz,(result->'next_cursor'->>'id')::bigint,2,(result->>'as_of')::timestamptz);
  if jsonb_array_length(page2->'rows')<>2 or page2->'rows'->0->>'id'=result->'rows'->0->>'id' then raise exception 'pagination page 2 wrong';end if;checks:=checks+1;
  begin
    perform public.list_activity_log(grp,current_date,current_date-1);raise exception 'invalid range accepted';
  exception when invalid_parameter_value then checks:=checks+1;end;
  begin
    perform public.list_activity_log(grp,current_date,current_date,null,null,null,null,null,101);raise exception 'invalid page size accepted';
  exception when invalid_parameter_value then checks:=checks+1;end;
  perform private.audit(grp,game,'unknown_action',null,'{"token":"DO_NOT_EXPORT"}'::jsonb);
  result:=public.list_activity_log(grp,current_date-1,current_date+1,null,null,'unknown_action');
  if result::text like '%DO_NOT_EXPORT%' then raise exception 'details secret leak';end if;checks:=checks+1;
  update public.profiles set display_name='Renamed organiser' where user_id=org;
  result:=public.list_activity_log(grp,current_date-1,current_date+1,game,null,'game_updated');
  if result->'rows'->0->>'actor_name' is distinct from 'Organiser' then raise exception 'actor name snapshot changed';end if;checks:=checks+1;
  select count(*) into event_count from public.audit_events where game_id=game;
  perform public.set_game_status(game,'cancelled');perform public.delete_game(game);
  if (select count(*) from public.audit_events where event_context->>'game_ref'=game::text)<event_count then raise exception 'game deletion erased history';end if;checks:=checks+1;
  result:=public.list_activity_log(grp,current_date-1,current_date+1,game,null,'game_updated');
  if result->'rows'->0->>'game_title' is distinct from 'New title' then raise exception 'deleted game context missing';end if;checks:=checks+1;
  delete from auth.users where id=org;
  result:=public.list_activity_log(grp,current_date-1,current_date+1,game,org,'game_updated');
  if result->'rows'->0->>'actor_name' is distinct from 'Organiser' then raise exception 'deleted account attribution missing';end if;checks:=checks+1;
  set local role authenticated;
  select count(*) into event_count from public.audit_events where group_id=grp;
  if event_count=0 then raise exception 'admin raw RLS read failed';end if;checks:=checks+1;
  reset role;
  set local role anon;
  begin
    perform public.list_activity_log(grp,current_date-1,current_date+1);raise exception 'anon RPC allowed';
  exception when insufficient_privilege then checks:=checks+1;end;
  reset role;
  raise notice 'FR013 assertions passed: %',checks;
end $$;
rollback;
