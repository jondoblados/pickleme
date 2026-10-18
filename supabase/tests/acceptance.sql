-- PickleMe database acceptance tests. Runs entirely inside one DO block and always rolls back
-- by raising an exception whose message contains the results.
do $$
declare
  u uuid[] := '{}'; admin uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  grp uuid; game uuid; inv jsonb; r jsonb; log text := ''; i int; n int; ok boolean;
  procedure_dummy int;
begin
  -- helper-ish: create users
  insert into auth.users (id, email, aud, role) values (admin, 'admin@test.local', 'authenticated', 'authenticated');
  insert into auth.users (id, email, aud, role) values (outsider, 'out@test.local', 'authenticated', 'authenticated');
  for i in 1..20 loop
    u := u || gen_random_uuid();
    insert into auth.users (id, email, aud, role) values (u[i], 'p'||i||'@test.local', 'authenticated', 'authenticated');
  end loop;
  select id into grp from public.groups where name = 'Tuesday Socials @CBP1';
  insert into public.group_members (group_id, user_id, role) values (grp, admin, 'admin');

  -- act as admin
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  perform public.set_display_name('Admin');
  inv := public.create_invite(grp, 30, 100);
  game := public.create_game(grp, 'Test Tuesday', now() + interval '2 days', now() + interval '2 days 2 hours', 'CBP1', 16, '');

  -- players redeem invite, set names, join in order
  for i in 1..19 loop
    perform set_config('request.jwt.claims', json_build_object('sub', u[i], 'role', 'authenticated')::text, true);
    perform public.redeem_invite(inv->>'token');
    perform public.set_display_name('Player ' || i);
    r := public.join_game(game);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u[16], 'role', 'authenticated')::text, true);
  r := private.position_of(game, u[16]);
  log := log || format(E'T1 p16 playing #16: %s\n', r = '{"status":"playing","position":16}');
  r := private.position_of(game, u[17]);
  log := log || format(E'T2 p17 waitlist #1: %s\n', r = '{"status":"waitlist","position":1}');
  r := private.position_of(game, u[18]);
  log := log || format(E'T2b p18 waitlist #2: %s\n', r = '{"status":"waitlist","position":2}');

  -- double join
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  r := public.join_game(game);
  select count(*) into n from public.registrations where game_id = game and cancelled_at is null;
  log := log || format(E'T3 double join no duplicate (19 active): %s, already=%s\n', n = 19, r->>'already_registered');

  -- attendee withdraws -> p17 promoted, p18 waitlist #1
  perform set_config('request.jwt.claims', json_build_object('sub', u[5], 'role', 'authenticated')::text, true);
  r := public.withdraw_game(game);
  log := log || format(E'T4 withdraw promoted=1: %s; p17 playing: %s; p18 wl#1: %s\n', r->>'promoted' = '1',
    private.position_of(game, u[17])->>'status' = 'playing',
    private.position_of(game, u[18]) = '{"status":"waitlist","position":1}');
  select count(*) into n from public.notification_outbox where game_id = game and user_id = u[17] and kind = 'promoted';
  log := log || format(E'T4b outbox row for p17: %s\n', n = 1);

  -- waitlisted withdraws -> closes up
  perform set_config('request.jwt.claims', json_build_object('sub', u[18], 'role', 'authenticated')::text, true);
  perform public.withdraw_game(game);
  log := log || format(E'T5 p19 moves to wl#1: %s\n', private.position_of(game, u[19]) = '{"status":"waitlist","position":1}');

  -- rejoin goes to end
  perform set_config('request.jwt.claims', json_build_object('sub', u[5], 'role', 'authenticated')::text, true);
  r := public.join_game(game);
  log := log || format(E'T6 p5 rejoins at wl#2: %s\n', r->>'status' = 'waitlist' and r->>'position' = '2');

  -- outsider (not member)
  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  begin perform public.get_game(game); log := log || E'T7 outsider get_game blocked: false\n';
  exception when others then log := log || format(E'T7 outsider get_game blocked: %s\n', sqlerrm = 'not_member'); end;
  begin perform public.join_game(game); log := log || E'T7b outsider join blocked: false\n';
  exception when others then log := log || format(E'T7b outsider join blocked: %s\n', sqlerrm = 'not_member'); end;
  set local role authenticated;
  select count(*) into n from public.registrations where game_id = game;
  log := log || format(E'T8 outsider RLS sees 0 registrations: %s\n', n = 0);
  select count(*) into n from public.profiles;
  log := log || format(E'T8b outsider sees 0 profiles: %s\n', n = 0);
  reset role;

  -- player tries organiser actions & direct writes
  perform set_config('request.jwt.claims', json_build_object('sub', u[2], 'role', 'authenticated')::text, true);
  begin perform public.remove_registration(game, u[3]); log := log || E'T9 player remove blocked: false\n';
  exception when others then log := log || format(E'T9 player remove blocked: %s\n', sqlerrm = 'forbidden'); end;
  begin perform public.set_member_role(grp, u[2], 'admin'); log := log || E'T10 self-promote blocked: false\n';
  exception when others then log := log || format(E'T10 self-promote blocked: %s\n', sqlerrm = 'forbidden'); end;
  set local role authenticated;
  select count(*) into n from public.registrations where game_id = game and cancelled_at is null;
  log := log || format(E'T11 member RLS sees 18 active: %s\n', n = 18);
  begin insert into public.registrations (game_id, user_id, queue_no) values (game, u[2], 999);
    log := log || E'T12 direct insert blocked: false\n';
  exception when others then log := log || format(E'T12 direct insert blocked: %s (%s)\n', true, sqlstate); end;
  begin update public.group_members set role = 'admin' where user_id = u[2];
    get diagnostics n = row_count; log := log || format(E'T13 direct role update blocked: %s\n', n = 0);
  exception when others then log := log || format(E'T13 direct role update blocked: %s (%s)\n', true, sqlstate); end;
  reset role;
  r := public.get_game(game);
  log := log || format(E'T14 roster has no email: %s; roster size 18: %s\n', position('test.local' in r::text) = 0, jsonb_array_length(r->'roster') = 18);

  -- organiser capacity changes
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  begin perform public.update_game(game, 'Test Tuesday', now() + interval '2 days', now() + interval '2 days 2 hours', 'CBP1', 10, '');
    log := log || E'T15 capacity below attendees blocked: false\n';
  exception when others then log := log || format(E'T15 capacity below attendees blocked: %s\n', sqlerrm = 'capacity_below_attendees'); end;
  r := public.update_game(game, 'Test Tuesday', now() + interval '2 days', now() + interval '2 days 2 hours', 'CBP1', 17, '');
  log := log || format(E'T16 capacity 17 promotes p19: %s\n', r->>'promoted' = '1' and private.position_of(game, u[19])->>'status' = 'playing');
  -- organiser removes a player
  r := public.remove_registration(game, u[3]);
  log := log || format(E'T17 organiser removal promotes p5: %s\n', private.position_of(game, u[5])->>'status' = 'playing');
  -- close registration: join blocked, withdraw ok
  perform public.set_game_status(game, 'closed');
  perform set_config('request.jwt.claims', json_build_object('sub', u[20], 'role', 'authenticated')::text, true);
  perform public.redeem_invite(inv->>'token'); perform public.set_display_name('Player 20');
  begin perform public.join_game(game); log := log || E'T18 closed join blocked: false\n';
  exception when others then log := log || format(E'T18 closed join blocked: %s\n', sqlerrm = 'registration_closed'); end;
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  r := public.withdraw_game(game);
  log := log || format(E'T19 withdraw allowed when closed: %s\n', r->>'cancelled' = 'true');
  -- invalid invite
  begin perform public.redeem_invite('nope'); log := log || E'T20 bad invite rejected: false\n';
  exception when others then log := log || format(E'T20 bad invite rejected: %s\n', sqlerrm = 'invite_invalid'); end;
  -- list_games for a member
  r := public.list_games(false);
  log := log || format(E'T21 list_games returns test game: %s\n', r @> jsonb_build_array(jsonb_build_object('id', game)));

  raise exception 'RESULTS%', E'\n' || log;
end $$;
