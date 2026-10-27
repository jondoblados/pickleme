-- Seeds pre-v0.9.1 history (run BEFORE migration 20261027000014) so the one-off repair is exercised.
-- Disposable CI database only. Fixed IDs let activity_join_names.sql find these rows.
do $$
declare adm uuid:='a0000000-0000-4000-8000-000000000001'; joiner uuid:='a0000000-0000-4000-8000-000000000002';
  waiter uuid:='a0000000-0000-4000-8000-000000000003'; grp uuid:='a0000000-0000-4000-8000-0000000000aa';
  inv jsonb; game uuid;
begin
  insert into auth.users(id,email,aud,role,email_confirmed_at) values
    (adm,'seed-admin@fr014.invalid','authenticated','authenticated',now()),
    (joiner,'seed-joiner@fr014.invalid','authenticated','authenticated',now()),
    (waiter,'seed-waiter@fr014.invalid','authenticated','authenticated',now());
  insert into public.profiles(user_id,display_name) values(adm,'Seed Admin'),(waiter,'Seed Waiter');
  insert into public.groups(id,name) values(grp,'Seed group');
  insert into public.group_members(group_id,user_id,role) values(grp,adm,'admin'),(grp,waiter,'player');
  perform set_config('request.jwt.claims',json_build_object('sub',adm)::text,true);
  inv:=public.create_invite(grp,30,100);
  game:=public.create_game(grp,'Seed game',now()+interval '1 day',now()+interval '1 day 2 hours','Court',1,null);
  perform public.join_game(game);
  -- Old behaviour: joiner redeems before saving a name, then the profile appears later.
  perform set_config('request.jwt.claims',json_build_object('sub',joiner)::text,true);
  perform public.redeem_invite(inv->>'token');
  insert into public.profiles(user_id,display_name) values(joiner,'Seed Joiner Renamed');
  -- Old behaviour: promotion recorded with the withdrawing admin as actor.
  perform set_config('request.jwt.claims',json_build_object('sub',waiter)::text,true);
  perform public.join_game(game);
  perform set_config('request.jwt.claims',json_build_object('sub',adm)::text,true);
  perform public.withdraw_game(game);
  if not exists(select 1 from public.audit_events where action='member_joined' and actor_id=joiner and event_context->>'actor_name' is null)
    then raise exception 'seed: expected unnamed join row'; end if;
  if not exists(select 1 from public.audit_events where action='promoted' and actor_id=adm)
    then raise exception 'seed: expected promotion with actor'; end if;
end $$;
