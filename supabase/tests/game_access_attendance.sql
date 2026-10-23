-- FR-006 / FR-007 acceptance tests: shared-game onboarding and attendance.
-- Run after migration 20261023000005 in the same script. Always rolls back by raising
-- an exception whose message contains the results (every line should end in "true").
do $$
declare
  u uuid[] := '{}'; admin uuid := gen_random_uuid(); org_b uuid := gen_random_uuid();
  unverified uuid := gen_random_uuid(); fresh uuid := gen_random_uuid();
  grp uuid; grp_b uuid; g_future uuid; g_past uuid; g_live uuid; g_old uuid; g_unviewed uuid;
  g_cancel uuid; g_tz uuid; g_closed uuid;
  r jsonb; log text := ''; i int; n int; t text;
  procedure_dummy int;
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (admin, 'fa-admin@test.local', 'authenticated', 'authenticated', now()),
    (org_b, 'fa-orgb@test.local', 'authenticated', 'authenticated', now()),
    (fresh, 'fa-fresh@test.local', 'authenticated', 'authenticated', now()),
    (unverified, 'fa-unverified@test.local', 'authenticated', 'authenticated', null);
  for i in 1..8 loop
    u := u || gen_random_uuid();
    insert into auth.users (id, email, aud, role, email_confirmed_at)
    values (u[i], 'fa-p'||i||'@test.local', 'authenticated', 'authenticated', now());
  end loop;
  insert into public.groups (name, timezone) values ('FA Test Group A', 'Asia/Singapore') returning id into grp;
  insert into public.groups (name, timezone) values ('FA Test Group B', 'Asia/Singapore') returning id into grp_b;
  insert into public.group_members (group_id, user_id, role) values (grp, admin, 'admin'), (grp_b, org_b, 'organiser');
  insert into public.profiles (user_id, display_name) values (admin, 'FA Admin'), (org_b, 'FA Org B'), (unverified, 'Unverified');
  for i in 1..8 loop insert into public.profiles (user_id, display_name) values (u[i], 'FA Player ' || i); end loop;

  -- ===== FR-006: shared game link onboarding =====
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by)
  values (grp, 'FA Future', now() + interval '2 days', now() + interval '2 days 2 hours', 2, admin) returning id into g_future;

  perform set_config('request.jwt.claims', '', true);
  begin perform public.preview_shared_game(g_future); log := log || E'S1 anonymous preview blocked: false\n';
  exception when others then log := log || format(E'S1 anonymous preview blocked: %s\n', sqlerrm = 'not_signed_in'); end;

  perform set_config('request.jwt.claims', json_build_object('sub', fresh, 'role', 'authenticated')::text, true);
  r := public.preview_shared_game(g_future);
  log := log || format(E'S2 fresh user preview: not member, can join, no roster: %s\n',
    r->>'member' = 'false' and r->>'can_join' = 'true' and not r ? 'roster');
  begin perform public.get_game(g_future); log := log || E'S3 non-member cannot read roster: false\n';
  exception when others then log := log || format(E'S3 non-member cannot read roster: %s\n', sqlerrm = 'not_member'); end;

  begin perform public.join_shared_game(g_future); log := log || E'S4 join without display name blocked: false\n';
  exception when others then log := log || format(E'S4 join without display name blocked: %s\n', sqlerrm = 'display_name_required'); end;
  select count(*) into n from public.group_members where group_id = grp and user_id = fresh;
  log := log || format(E'S5 failed join leaves no membership: %s\n', n = 0);

  perform public.set_display_name('FA Fresh');
  r := public.join_shared_game(g_future);
  log := log || format(E'S6 fresh user joins as playing #1: %s\n', r->>'status' = 'playing' and r->>'position' = '1');
  select count(*) into n from public.group_members where group_id = grp and user_id = fresh and role = 'player';
  log := log || format(E'S7 one player membership created: %s\n', n = 1);
  r := public.join_shared_game(g_future);
  select count(*) into n from public.registrations where game_id = g_future and user_id = fresh and cancelled_at is null;
  log := log || format(E'S8 repeat join no duplicate: %s\n', n = 1 and r->>'already_registered' = 'true');
  select count(*) into n from public.audit_events where game_id = g_future and action = 'member_joined_via_game' and target_user_id = fresh;
  log := log || format(E'S9 membership-via-game audited once: %s\n', n = 1);
  r := public.get_game(g_future);
  log := log || format(E'S10 new member can now read game: %s\n', r is not null);

  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  r := public.join_shared_game(g_future);
  log := log || format(E'S11 second user playing #2: %s\n', r->>'status' = 'playing' and r->>'position' = '2');
  perform set_config('request.jwt.claims', json_build_object('sub', u[2], 'role', 'authenticated')::text, true);
  r := public.join_shared_game(g_future);
  log := log || format(E'S12 full game -> waitlist #1: %s\n', r->>'status' = 'waitlist' and r->>'position' = '1');

  perform set_config('request.jwt.claims', json_build_object('sub', unverified, 'role', 'authenticated')::text, true);
  begin perform public.join_shared_game(g_future); log := log || E'S13 unverified email blocked: false\n';
  exception when others then log := log || format(E'S13 unverified email blocked: %s\n', sqlerrm = 'verified_email_required'); end;
  select count(*) into n from public.group_members where user_id = unverified;
  log := log || format(E'S13b unverified gets no membership: %s\n', n = 0);

  -- Organiser of another group joins group A via link: stays organiser in B, becomes player in A only.
  perform set_config('request.jwt.claims', json_build_object('sub', org_b, 'role', 'authenticated')::text, true);
  r := public.join_shared_game(g_future);
  log := log || format(E'S14 member of other group can join: %s\n', r->>'status' = 'waitlist');
  select count(*) into n from public.group_members where user_id = org_b and
    ((group_id = grp and role = 'player') or (group_id = grp_b and role = 'organiser'));
  log := log || format(E'S14b no role elevation, other group unchanged: %s\n', n = 2);

  -- Existing admin opening the link keeps admin role.
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  perform public.join_shared_game(g_future);
  select role::text into t from public.group_members where group_id = grp and user_id = admin;
  log := log || format(E'S15 admin keeps admin role: %s\n', t = 'admin');

  -- Closed / cancelled / started games: no membership granted.
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, status)
  values (grp_b, 'FA Closed', now() + interval '1 day', now() + interval '1 day 2 hours', 4, org_b, 'closed') returning id into g_closed;
  perform set_config('request.jwt.claims', json_build_object('sub', u[3], 'role', 'authenticated')::text, true);
  r := public.preview_shared_game(g_closed);
  log := log || format(E'S16 closed game preview can_join=false: %s\n', r->>'can_join' = 'false');
  begin perform public.join_shared_game(g_closed); log := log || E'S16b closed join blocked: false\n';
  exception when others then log := log || format(E'S16b closed join blocked: %s\n', sqlerrm = 'registration_closed'); end;
  update public.games set status = 'cancelled' where id = g_closed;
  begin perform public.join_shared_game(g_closed); log := log || E'S17 cancelled join blocked: false\n';
  exception when others then log := log || format(E'S17 cancelled join blocked: %s\n', sqlerrm = 'game_cancelled'); end;
  select count(*) into n from public.group_members where group_id = grp_b and user_id = u[3];
  log := log || format(E'S18 no membership from blocked joins: %s\n', n = 0);
  begin perform public.preview_shared_game(gen_random_uuid()); log := log || E'S19 unknown game: false\n';
  exception when others then log := log || format(E'S19 unknown game rejected: %s\n', sqlerrm = 'game_not_found'); end;

  -- Withdraw still works with the new registration trigger (trigger must return NEW).
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  r := public.withdraw_game(g_future);
  log := log || format(E'S20 withdraw works, waitlist promoted: %s\n', r->>'promoted' = '1'
    and private.position_of(g_future, u[2])->>'status' = 'playing');

  -- ===== FR-007: attendance =====
  -- Finished game, capacity 3. Expected = u1, u3, u4 (u2 withdrew before start; u4 withdrew after start; u5 waitlist).
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no)
  values (grp, 'FA Past', now() - interval '3 hours', now() - interval '1 hour', 3, admin, 6) returning id into g_past;
  insert into public.group_members (group_id, user_id, role) select grp, x, 'player' from unnest(u) x on conflict do nothing;
  insert into public.registrations (game_id, user_id, queue_no, joined_at, cancelled_at, cancel_reason) values
    (g_past, u[1], 1, now() - interval '2 days', null, null),
    (g_past, u[2], 2, now() - interval '2 days', now() - interval '1 day', 'withdrew'),
    (g_past, u[3], 3, now() - interval '2 days', null, null),
    (g_past, u[4], 4, now() - interval '2 days', now() - interval '2 hours', 'withdrew'),
    (g_past, u[5], 5, now() - interval '2 days', null, null);

  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  begin perform public.get_game_attendance(g_past); log := log || E'A1 player read blocked: false\n';
  exception when others then log := log || format(E'A1 player read blocked: %s\n', sqlerrm = 'forbidden'); end;
  begin perform public.mark_game_attendance(g_past, u[1], 'present'); log := log || E'A2 player mark blocked: false\n';
  exception when others then log := log || format(E'A2 player mark blocked: %s\n', sqlerrm = 'forbidden'); end;
  begin perform public.attendance_report(grp, current_date - 7, current_date); log := log || E'A3 player report blocked: false\n';
  exception when others then log := log || format(E'A3 player report blocked: %s\n', sqlerrm = 'forbidden'); end;
  perform set_config('request.jwt.claims', json_build_object('sub', org_b, 'role', 'authenticated')::text, true);
  begin perform public.get_game_attendance(g_past); log := log || E'A4 other-group organiser blocked: false\n';
  exception when others then log := log || format(E'A4 other-group organiser blocked: %s\n', sqlerrm = 'forbidden'); end;
  begin perform public.attendance_report(grp, current_date - 7, current_date); log := log || E'A4b other-group report blocked: false\n';
  exception when others then log := log || format(E'A4b other-group report blocked: %s\n', sqlerrm = 'forbidden'); end;
  set local role authenticated;
  begin select count(*) into n from public.game_attendance; log := log || E'A5 direct table read denied: false\n';
  exception when insufficient_privilege then log := log || E'A5 direct table read denied: true\n'; end;
  begin insert into public.game_attendance (game_id, user_id, status) values (g_past, org_b, 'present'); log := log || E'A5b direct write denied: false\n';
  exception when insufficient_privilege then log := log || E'A5b direct write denied: true\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  r := public.get_game_attendance(g_past);
  select count(*) into n from jsonb_array_elements(r->'rows') e where (e->>'user_id')::uuid = any(array[u[1], u[3], u[4]]) and e->>'status' = 'unmarked';
  log := log || format(E'A6 expected = first 3 at start (excl. pre-start withdrawal, keeps post-start, no waitlist): %s\n',
    n = 3 and jsonb_array_length(r->'rows') = 3 and r->>'started' = 'true' and r->>'ended' = 'true');
  update public.games set capacity = 1 where id = g_past;
  r := public.get_game_attendance(g_past);
  log := log || format(E'A7 idempotent, survives capacity change: %s\n', jsonb_array_length(r->'rows') = 3);

  perform public.mark_game_attendance(g_past, u[1], 'present');
  perform public.mark_game_attendance(g_past, u[3], 'no_show');
  perform public.mark_game_attendance(g_past, u[4], 'excused');
  r := public.get_game_attendance(g_past);
  select count(*) into n from jsonb_array_elements(r->'rows') e where
    (e->>'user_id' = u[1]::text and e->>'status' = 'present') or (e->>'user_id' = u[3]::text and e->>'status' = 'no_show')
    or (e->>'user_id' = u[4]::text and e->>'status' = 'excused');
  log := log || format(E'A8 marks saved: %s\n', n = 3);
  begin perform public.mark_game_attendance(g_past, u[5], 'present'); log := log || E'A9 waitlisted player rejected: false\n';
  exception when others then log := log || format(E'A9 waitlisted player rejected: %s\n', sqlerrm = 'not_expected_player'); end;
  begin perform public.mark_game_attendance(g_past, u[1], 'late'); log := log || E'A10 invalid status rejected: false\n';
  exception when others then log := log || format(E'A10 invalid status rejected: %s\n', sqlerrm = 'invalid_attendance_status'); end;

  -- Correction present -> no_show -> excused, each audited with actor.
  perform public.mark_game_attendance(g_past, u[1], 'no_show');
  perform public.mark_game_attendance(g_past, u[1], 'excused');
  select count(*) into n from public.audit_events where game_id = g_past and action = 'attendance_changed' and actor_id = admin;
  log := log || format(E'A11 corrections audited (5 changes): %s\n', n = 5);
  select status into t from public.game_attendance where game_id = g_past and user_id = u[1];
  log := log || format(E'A11b final status excused: %s\n', t = 'excused');

  -- In-progress game: present allowed, no-show not yet.
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no)
  values (grp, 'FA Live', now() - interval '30 minutes', now() + interval '1 hour', 4, admin, 2) returning id into g_live;
  insert into public.registrations (game_id, user_id, queue_no, joined_at) values (g_live, u[6], 1, now() - interval '1 day');
  perform public.mark_game_attendance(g_live, u[6], 'present');
  log := log || E'A12 present during game allowed: true\n';
  begin perform public.mark_game_attendance(g_live, u[6], 'no_show'); log := log || E'A13 no-show before end blocked: false\n';
  exception when others then log := log || format(E'A13 no-show before end blocked: %s\n', sqlerrm = 'no_show_after_game_only'); end;

  r := public.get_game_attendance(g_future);
  log := log || format(E'A14 future game not started, no rows: %s\n', r->>'started' = 'false' and jsonb_array_length(r->'rows') = 0);
  begin perform public.mark_game_attendance(g_future, fresh, 'present'); log := log || E'A15 future mark blocked: false\n';
  exception when others then log := log || format(E'A15 future mark blocked: %s\n', sqlerrm = 'attendance_unavailable'); end;

  -- Reports: second no-show for u3 in an older game; an unviewed game; a game cancelled after marking.
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no)
  values (grp, 'FA Old', now() - interval '8 days', now() - interval '8 days' + interval '2 hours', 4, admin, 3) returning id into g_old;
  insert into public.registrations (game_id, user_id, queue_no, joined_at) values
    (g_old, u[3], 1, now() - interval '9 days'), (g_old, u[7], 2, now() - interval '9 days');
  perform public.mark_game_attendance(g_old, u[3], 'no_show');
  perform public.mark_game_attendance(g_old, u[7], 'present');

  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no)
  values (grp, 'FA Unviewed', now() - interval '5 days', now() - interval '5 days' + interval '2 hours', 4, admin, 2) returning id into g_unviewed;
  insert into public.registrations (game_id, user_id, queue_no, joined_at) values (g_unviewed, u[8], 1, now() - interval '6 days');

  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no)
  values (grp, 'FA Cancelled', now() - interval '4 days', now() - interval '4 days' + interval '2 hours', 4, admin, 2) returning id into g_cancel;
  insert into public.registrations (game_id, user_id, queue_no, joined_at) values (g_cancel, u[3], 1, now() - interval '5 days');
  perform public.mark_game_attendance(g_cancel, u[3], 'no_show');
  update public.games set status = 'cancelled' where id = g_cancel;

  r := public.attendance_report(grp, (now() at time zone 'Asia/Singapore')::date - 30, (now() at time zone 'Asia/Singapore')::date);
  select count(*) into n from jsonb_array_elements(r) e where e->>'user_id' = u[3]::text and e->>'status' = 'no_show';
  log := log || format(E'R1 repeat offender u3 has 2 no-shows (cancelled excluded): %s\n', n = 2);
  select count(*) into n from jsonb_array_elements(r) e where e->>'game_id' = g_cancel::text;
  log := log || format(E'R2 cancelled game excluded: %s\n', n = 0);
  select count(*) into n from jsonb_array_elements(r) e where e->>'game_id' = g_unviewed::text and e->>'user_id' = u[8]::text and e->>'status' = 'unmarked';
  log := log || format(E'R3 never-opened game captured as unmarked: %s\n', n = 1);
  select count(*) into n from jsonb_array_elements(r) e where e->>'game_id' = g_future::text;
  log := log || format(E'R4 future game excluded: %s\n', n = 0);
  select count(*) into n from jsonb_array_elements(r) e where e->>'game_id' = g_old::text;
  log := log || format(E'R5 group A report has 2 rows for old game: %s\n', n = 2);

  -- Group-timezone date boundaries: 2026-01-01 23:30 SGT = 15:30 UTC.
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no)
  values (grp, 'FA TZ', '2026-01-01 15:30+00', '2026-01-01 17:30+00', 4, admin, 2) returning id into g_tz;
  insert into public.registrations (game_id, user_id, queue_no, joined_at) values (g_tz, u[7], 1, '2025-12-30 00:00+00');
  r := public.attendance_report(grp, '2026-01-01', '2026-01-01');
  log := log || format(E'R6 SGT date boundary includes game on Jan 1: %s\n', jsonb_array_length(r) = 1);
  r := public.attendance_report(grp, '2026-01-02', '2026-01-02');
  log := log || format(E'R7 next SGT day excludes it: %s\n', jsonb_array_length(r) = 0);
  begin perform public.attendance_report(grp, '2026-02-01', '2026-01-01'); log := log || E'R8 reversed range rejected: false\n';
  exception when others then log := log || format(E'R8 reversed range rejected: %s\n', sqlerrm = 'invalid_date_range'); end;
  begin perform public.attendance_report(grp, '2024-01-01', '2026-01-01'); log := log || E'R9 over-1-year range rejected: false\n';
  exception when others then log := log || format(E'R9 over-1-year range rejected: %s\n', sqlerrm = 'invalid_date_range'); end;

  -- Games that had already started before the migration are not backfilled.
  select count(*) into n from public.games g where g.created_at < now() - interval '1 minute' and g.starts_at <= now()
    and not exists (select 1 from public.attendance_sessions s where s.game_id = g.id);
  log := log || format(E'M1 all pre-existing started games marked as no-capture: %s\n', n = 0);
  -- Games that started before the v0.3.0 release (2026-10-23 11:25 UTC) must have no attendance rows.
  select count(*) into n from public.game_attendance a join public.games g on g.id = a.game_id where g.starts_at < '2026-10-23 11:25+00' and g.created_at < now();
  log := log || format(E'M2 no attendance rows invented for games started before release: %s\n', n = 0);

  select count(*) filter (where l ~ ': (t|true)$'), count(*) filter (where l <> '' and l !~ ': (t|true)$'),
         coalesce(string_agg(l, ' | ') filter (where l <> '' and l !~ ': (t|true)$'), 'none')
    into i, n, t from unnest(string_to_array(log, E'\n')) l;
  raise exception 'RESULTS passed=% failed=% failing=[%]%', i, n, t, E'\n' || log;
end $$;
