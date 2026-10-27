-- Integration tests for v0.9.1 (activity log names). Run after activity_join_names_seed.sql and
-- migration 20261027000014. New fixtures roll back.
begin;
do $$
declare s_adm uuid:='a0000000-0000-4000-8000-000000000001'; s_joiner uuid:='a0000000-0000-4000-8000-000000000002';
  s_grp uuid:='a0000000-0000-4000-8000-0000000000aa';
  admin uuid:=gen_random_uuid(); newbie uuid:=gen_random_uuid(); p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid();
  grp uuid:=gen_random_uuid(); inv jsonb; game uuid; res jsonb; r jsonb; checks int:=0; today date:=current_date;
begin
  -- Repair of seeded history (stable IDs only)
  perform set_config('request.jwt.claims',json_build_object('sub',s_adm)::text,true);
  res:=public.list_activity_log(s_grp,today-1,today+1);
  select e into r from jsonb_array_elements(res->'rows') e where e->>'action'='member_joined';
  if r->>'actor_name'<>'Seed Joiner Renamed' or r->>'target_name'<>'Seed Joiner Renamed' or r->>'actor_kind'<>'self'
     or r->>'actor_name_origin'<>'repaired_current_profile' or r->>'actor_id'<>s_joiner::text then raise exception 'repaired join %',r; end if; checks:=checks+1;
  select e into r from jsonb_array_elements(res->'rows') e where e->>'action'='promoted';
  if r->>'actor_kind'<>'system' or r->>'actor_id' is not null or r->>'actor_name' is not null
     or r->>'triggered_by_name'<>'Seed Admin' or r->'details'->>'triggered_by'<>s_adm::text then raise exception 'repaired promo %',r; end if; checks:=checks+1;
  if (select actor_id from public.audit_events where group_id=s_grp and action='promoted') is not null then raise exception 'promo actor_id not cleared'; end if; checks:=checks+1;

  -- New fixtures
  insert into auth.users(id,email,aud,role,email_confirmed_at) values
    (admin,'a@fr014.invalid','authenticated','authenticated',now()),(newbie,'n@fr014.invalid','authenticated','authenticated',now()),
    (p1,'p1@fr014.invalid','authenticated','authenticated',now()),(p2,'p2@fr014.invalid','authenticated','authenticated',now());
  insert into public.profiles(user_id,display_name) values(admin,'Admin A'),(p1,'Player One'),(p2,'Player Two');
  insert into public.groups(id,name) values(grp,'v091');
  insert into public.group_members(group_id,user_id,role) values(grp,admin,'admin'),(grp,p1,'player'),(grp,p2,'player');
  perform set_config('request.jwt.claims',json_build_object('sub',admin)::text,true);
  inv:=public.create_invite(grp,30,100);

  -- Self-join before a profile exists, then first name save fills the row by user ID
  perform set_config('request.jwt.claims',json_build_object('sub',newbie)::text,true);
  perform public.redeem_invite(inv->>'token');
  if (select event_context->>'actor_name' from public.audit_events where group_id=grp and action='member_joined') is not null
    then raise exception 'expected unnamed row before profile'; end if; checks:=checks+1;
  perform public.set_display_name('  New   Person ');
  perform set_config('request.jwt.claims',json_build_object('sub',admin)::text,true);
  res:=public.list_activity_log(grp,today-1,today+1);
  select e into r from jsonb_array_elements(res->'rows') e where e->>'action'='member_joined';
  if r->>'actor_name'<>'New Person' or r->>'target_name'<>'New Person' or r->>'actor_kind'<>'self'
     or r->>'actor_name_origin'<>'first_profile_name' then raise exception 'first name fill %',r; end if; checks:=checks+1;

  -- A later rename must not rewrite history
  perform set_config('request.jwt.claims',json_build_object('sub',newbie)::text,true);
  perform public.set_display_name('Renamed Later');
  if (select event_context->>'actor_name' from public.audit_events where group_id=grp and action='member_joined')<>'New Person'
    then raise exception 'rename rewrote history'; end if; checks:=checks+1;

  -- Admin acting on someone else is a member action
  perform set_config('request.jwt.claims',json_build_object('sub',admin)::text,true);
  perform public.set_member_role(grp,p1,'organiser');
  res:=public.list_activity_log(grp,today-1,today+1,null,null,'role_changed');
  r:=res->'rows'->0;
  if r->>'actor_kind'<>'member' or r->>'actor_name'<>'Admin A' or r->>'target_name'<>'Player One' then raise exception 'admin action %',r; end if; checks:=checks+1;

  -- Waitlist promotion is a system action, triggered by the withdrawing player
  game:=public.create_game(grp,'Cap one',now()+interval '1 day',now()+interval '1 day 2 hours','Court',1,null);
  perform set_config('request.jwt.claims',json_build_object('sub',p1)::text,true);
  perform public.join_game(game);
  perform set_config('request.jwt.claims',json_build_object('sub',p2)::text,true);
  perform public.join_game(game);
  perform set_config('request.jwt.claims',json_build_object('sub',p1)::text,true);
  perform public.withdraw_game(game);
  perform set_config('request.jwt.claims',json_build_object('sub',admin)::text,true);
  res:=public.list_activity_log(grp,today-1,today+1,null,null,'promoted');
  r:=res->'rows'->0;
  if r->>'actor_kind'<>'system' or r->>'actor_id' is not null or r->>'triggered_by_name'<>'Player One'
     or r->'details'->>'triggered_by'<>p1::text or (r->'details'->>'count')::int<>1 then raise exception 'promotion %',r; end if; checks:=checks+1;

  -- Page shape unchanged; non-admins still refused
  if not (res ? 'rows' and res ? 'next_cursor' and res ? 'as_of' and res ? 'timezone') then raise exception 'shape %',res; end if; checks:=checks+1;
  perform set_config('request.jwt.claims',json_build_object('sub',p2)::text,true);
  begin perform public.list_activity_log(grp,today-1,today+1); raise exception 'player allowed';
  exception when insufficient_privilege then checks:=checks+1; end;
  -- Display name validation unchanged
  begin perform public.set_display_name('   '); raise exception 'blank allowed';
  exception when invalid_parameter_value then checks:=checks+1; end;

  raise notice 'activity_join_names: % checks passed',checks;
end $$;
rollback;
