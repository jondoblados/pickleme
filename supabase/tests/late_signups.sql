-- FR-008 late sign-up tests. Run after migrations 20261023000005 and 20261023000006 in the same script.
-- Always rolls back by raising an exception whose message starts with the pass/fail summary.
do $$
declare
  u uuid[] := '{}'; admin uuid := gen_random_uuid(); outsider uuid := gen_random_uuid(); outsider2 uuid := gen_random_uuid();
  grp uuid; g uuid; g_end uuid; g_closed uuid; g_wait uuid; r jsonb; log text := ''; i int; n int; t text;
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (admin, 'ls-admin@test.local', 'authenticated', 'authenticated', now()),
    (outsider, 'ls-out@test.local', 'authenticated', 'authenticated', now()),
    (outsider2, 'ls-out2@test.local', 'authenticated', 'authenticated', now());
  for i in 1..6 loop
    u := u || gen_random_uuid();
    insert into auth.users (id, email, aud, role, email_confirmed_at) values (u[i], 'ls-p'||i||'@test.local', 'authenticated', 'authenticated', now());
  end loop;
  insert into public.groups (name, timezone) values ('LS Group', 'Asia/Singapore') returning id into grp;
  insert into public.group_members (group_id, user_id, role) values (grp, admin, 'admin');
  insert into public.group_members (group_id, user_id, role) select grp, x, 'player' from unnest(u) x;
  insert into public.profiles (user_id, display_name) values (admin, 'LS Admin'), (outsider, 'LS Out'), (outsider2, 'LS Out2');
  for i in 1..6 loop insert into public.profiles (user_id, display_name) values (u[i], 'LS P' || i); end loop;

  -- In-progress game, capacity 3, two players signed up before the start.
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no)
  values (grp, 'LS Live', now() - interval '20 minutes', now() + interval '100 minutes', 3, admin, 3) returning id into g;
  insert into public.registrations (game_id, user_id, queue_no, joined_at) values
    (g, u[1], 1, now() - interval '1 day'), (g, u[2], 2, now() - interval '1 day');

  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  r := public.preview_shared_game(g);
  log := log || format(E'L1 preview: started, can join while a place is free: %s\n', r->>'started' = 'true' and r->>'can_join' = 'true');

  perform set_config('request.jwt.claims', json_build_object('sub', u[3], 'role', 'authenticated')::text, true);
  r := public.join_game(g);
  log := log || format(E'L2 late join takes free place as playing #3: %s\n', r->>'status' = 'playing' and r->>'position' = '3');
  select count(*) into n from public.audit_events where game_id = g and action = 'joined_late' and target_user_id = u[3];
  log := log || format(E'L3 late join audited as joined_late: %s\n', n = 1);
  select status into t from public.game_attendance where game_id = g and user_id = u[3];
  log := log || format(E'L4 late joiner added to attendance as unmarked: %s\n', t = 'unmarked');
  select count(*) into n from public.game_attendance where game_id = g;
  log := log || format(E'L5 attendance = 2 at start + 1 late: %s\n', n = 3);

  perform set_config('request.jwt.claims', json_build_object('sub', u[4], 'role', 'authenticated')::text, true);
  begin perform public.join_game(g); log := log || E'L6 full in-progress game rejects join: false\n';
  exception when others then log := log || format(E'L6 full in-progress game rejects join (no waitlist): %s\n', sqlerrm = 'game_full_started'); end;
  select count(*) into n from public.registrations where game_id = g and user_id = u[4];
  log := log || format(E'L7 no registration created: %s\n', n = 0);

  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  r := public.preview_shared_game(g);
  log := log || format(E'L8 preview of full in-progress game can_join=false: %s\n', r->>'can_join' = 'false');
  begin perform public.join_shared_game(g); log := log || E'L9 shared link to full in-progress game rejected: false\n';
  exception when others then log := log || format(E'L9 shared link to full in-progress game rejected: %s\n', sqlerrm = 'game_full_started'); end;
  select count(*) into n from public.group_members where group_id = grp and user_id = outsider;
  log := log || format(E'L10 rejected shared-link join grants no membership: %s\n', n = 0);

  -- An at-start player withdraws mid-game: the place frees up and a new user takes it via the WhatsApp link.
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  perform public.withdraw_game(g);
  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  r := public.join_shared_game(g);
  log := log || format(E'L11 new user joins group + in-progress game via link: %s\n', r->>'status' = 'playing');
  select count(*) into n from public.group_members where group_id = grp and user_id = outsider and role = 'player';
  log := log || format(E'L12 membership created: %s\n', n = 1);
  select count(*) into n from public.game_attendance where game_id = g;
  log := log || format(E'L13 withdrawn at-start player kept, link joiner added (4 rows): %s\n', n = 4
    and exists (select 1 from public.game_attendance where game_id = g and user_id = u[1])
    and exists (select 1 from public.game_attendance where game_id = g and user_id = outsider and status = 'unmarked'));

  -- Organiser marks the late joiner; no-show still waits for the end.
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  perform public.mark_game_attendance(g, u[3], 'present');
  select status into t from public.game_attendance where game_id = g and user_id = u[3];
  log := log || format(E'L14 organiser can mark late joiner: %s\n', t = 'present');
  begin perform public.mark_game_attendance(g, outsider, 'no_show'); log := log || E'L15 no-show before end blocked: false\n';
  exception when others then log := log || format(E'L15 late joiner no-show blocked until end: %s\n', sqlerrm = 'no_show_after_game_only'); end;
  r := public.get_game_attendance(g);
  log := log || format(E'L16 attendance view lists late joiners: %s\n', jsonb_array_length(r->'rows') = 4);

  -- A late joiner who withdraws stays on the attendance list, like any post-start withdrawal.
  perform set_config('request.jwt.claims', json_build_object('sub', u[3], 'role', 'authenticated')::text, true);
  perform public.withdraw_game(g);
  select count(*) into n from public.game_attendance where game_id = g and user_id = u[3];
  log := log || format(E'L17 late joiner who withdraws stays on attendance: %s\n', n = 1);

  -- Ended and closed games.
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by)
  values (grp, 'LS Ended', now() - interval '3 hours', now() - interval '1 hour', 8, admin) returning id into g_end;
  perform set_config('request.jwt.claims', json_build_object('sub', u[5], 'role', 'authenticated')::text, true);
  begin perform public.join_game(g_end); log := log || E'L18 ended game rejects join: false\n';
  exception when others then log := log || format(E'L18 ended game rejects join: %s\n', sqlerrm = 'game_finished'); end;
  perform set_config('request.jwt.claims', json_build_object('sub', outsider2, 'role', 'authenticated')::text, true);
  r := public.preview_shared_game(g_end);
  log := log || format(E'L19 ended game preview can_join=false: %s\n', r->>'can_join' = 'false');
  begin perform public.join_shared_game(g_end); log := log || E'L20 ended game via link rejected: false\n';
  exception when others then log := log || format(E'L20 ended game via link rejected: %s\n', sqlerrm = 'game_finished'); end;
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, status)
  values (grp, 'LS Closed', now() - interval '10 minutes', now() + interval '1 hour', 8, admin, 'closed') returning id into g_closed;
  perform set_config('request.jwt.claims', json_build_object('sub', u[5], 'role', 'authenticated')::text, true);
  begin perform public.join_game(g_closed); log := log || E'L21 closed in-progress game rejects join: false\n';
  exception when others then log := log || format(E'L21 organiser-closed in-progress game rejects join: %s\n', sqlerrm = 'registration_closed'); end;

  -- Waitlisted player promoted after the start (capacity raised mid-game) is added as unmarked.
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no)
  values (grp, 'LS Wait', now() - interval '15 minutes', now() + interval '1 hour', 2, admin, 4) returning id into g_wait;
  insert into public.registrations (game_id, user_id, queue_no, joined_at) values
    (g_wait, u[1], 1, now() - interval '1 day'), (g_wait, u[2], 2, now() - interval '1 day'), (g_wait, u[6], 3, now() - interval '1 day');
  select count(*) into n from public.game_attendance where game_id = g_wait;
  log := log || format(E'L22 waitlisted player not on attendance while still waiting: %s\n',
    not exists (select 1 from public.game_attendance where game_id = g_wait and user_id = u[6]));
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  update public.games set capacity = 3 where id = g_wait;
  select status into t from public.game_attendance where game_id = g_wait and user_id = u[6];
  log := log || format(E'L23 promoted-after-start player added as unmarked: %s\n', t = 'unmarked');
  select count(*) into n from public.game_attendance where game_id = g_wait;
  log := log || format(E'L24 attendance = 2 at start + 1 promoted: %s\n', n = 3);

  -- Group report includes late joiners.
  r := public.attendance_report(grp, (now() at time zone 'Asia/Singapore')::date - 1, (now() at time zone 'Asia/Singapore')::date + 1);
  select count(*) into n from jsonb_array_elements(r) e where e->>'game_id' = g::text and e->>'user_id' = outsider::text and e->>'status' = 'unmarked';
  log := log || format(E'L25 report includes late joiner as unmarked: %s\n', n = 1);

  -- Before the start, behaviour is unchanged: a full game puts new sign-ups on the waitlist.
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by)
  values (grp, 'LS Future', now() + interval '1 day', now() + interval '1 day 2 hours', 2, admin) returning id into g;
  for i in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', u[i], 'role', 'authenticated')::text, true);
    r := public.join_game(g);
  end loop;
  log := log || format(E'L26 pre-start full game still uses waitlist: %s\n', r->>'status' = 'waitlist' and r->>'position' = '1');
  select count(*) into n from public.game_attendance where game_id = g;
  log := log || format(E'L27 no attendance rows before start: %s\n', n = 0);

  select count(*) filter (where l ~ ': (t|true)$'), count(*) filter (where l <> '' and l !~ ': (t|true)$'),
         coalesce(string_agg(l, ' | ') filter (where l <> '' and l !~ ': (t|true)$'), 'none')
    into i, n, t from unnest(string_to_array(log, E'\n')) l;
  raise exception 'RESULTS passed=% failed=% failing=[%]%', i, n, t, E'\n' || log;
end $$;
