-- FR-021 tests: scheduled game visibility, court booking fees and game-day slot confirmation.
-- Run after all migrations. Runs in a transaction that is rolled back; raises an exception listing failures if any check fails.
do $$
declare
  u uuid[] := '{}'; admin uuid := gen_random_uuid(); org uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  grp uuid; gh uuid; gv uuid; gv2 uuid; gd uuid; gf uuid; gc uuid; gfree uuid; gt uuid; gs uuid; gp uuid; gold uuid;
  r jsonb; log text := ''; i int; n int; t text; ts timestamptz; day_end timestamptz;
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (admin, 'fee-admin@test.local', 'authenticated', 'authenticated', now()),
    (org, 'fee-org@test.local', 'authenticated', 'authenticated', now()),
    (outsider, 'fee-out@test.local', 'authenticated', 'authenticated', now());
  for i in 1..6 loop
    u := u || gen_random_uuid();
    insert into auth.users (id, email, aud, role, email_confirmed_at) values (u[i], 'fee-p'||i||'@test.local', 'authenticated', 'authenticated', now());
  end loop;
  insert into public.groups (name, timezone) values ('Fee Group', 'Asia/Singapore') returning id into grp;
  insert into public.group_members (group_id, user_id, role) values (grp, admin, 'admin'), (grp, org, 'organiser');
  insert into public.group_members (group_id, user_id, role) select grp, x, 'player' from unnest(u) x;
  insert into public.profiles (user_id, display_name) values (admin, 'Fee Admin'), (org, 'Fee Org'), (outsider, 'Fee Out');
  for i in 1..6 loop insert into public.profiles (user_id, display_name) values (u[i], 'Fee P' || i); end loop;

  -- ===================== A. Visibility =====================
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  gh := public.create_game(grp, 'Hidden', now() + interval '20 days', now() + interval '20 days 2 hours', 'Court', 4, '', 'two_weeks_before');
  select visible_from = starts_at - interval '336 hours' into strict t from public.games where id = gh;
  log := log || format(E'A1 visible_from = start - 2 weeks: %s\n', t);
  r := public.get_game(gh);
  log := log || format(E'A2 organiser sees hidden game with visible_from: %s\n', r->'game'->>'visible_from' is not null and r->'game'->>'visibility' = 'two_weeks_before');
  select count(*) into n from jsonb_array_elements(public.list_games(false)) e where (e->>'id')::uuid = gh and e->>'visible_from' is not null;
  log := log || format(E'A3 organiser list includes hidden game: %s\n', n = 1);

  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  begin perform public.get_game(gh); log := log || E'A4 admin sees hidden game: true\n';
  exception when others then log := log || format(E'A4 admin sees hidden game: false (%s)\n', sqlerrm); end;

  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  begin perform public.get_game(gh); log := log || E'A5 player get_game hidden: false\n';
  exception when others then log := log || format(E'A5 player get_game hidden -> game_not_found: %s\n', sqlerrm = 'game_not_found'); end;
  select count(*) into n from jsonb_array_elements(public.list_games(false)) e where (e->>'id')::uuid = gh;
  log := log || format(E'A6 player list excludes hidden game: %s\n', n = 0);
  begin perform public.join_game(gh); log := log || E'A7 player join hidden: false\n';
  exception when others then log := log || format(E'A7 player join hidden -> game_not_found: %s\n', sqlerrm = 'game_not_found'); end;
  begin perform public.get_game_weather(gh); log := log || E'A8 player weather hidden: false\n';
  exception when others then log := log || format(E'A8 player weather hidden -> game_not_found: %s\n', sqlerrm = 'game_not_found'); end;
  begin perform public.preview_shared_game(gh); log := log || E'A9 player preview hidden: false\n';
  exception when others then log := log || format(E'A9 player preview hidden -> game_not_found: %s\n', sqlerrm = 'game_not_found'); end;
  set local role authenticated;
  select count(*) into n from public.games where id = gh;
  log := log || format(E'A10 player RLS sees 0 hidden games: %s\n', n = 0);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  begin perform public.join_shared_game(gh); log := log || E'A11 outsider shared-link join hidden: false\n';
  exception when others then log := log || format(E'A11 outsider shared-link join hidden -> game_not_found: %s\n', sqlerrm = 'game_not_found'); end;
  select count(*) into n from public.group_members where group_id = grp and user_id = outsider;
  log := log || format(E'A12 no membership granted: %s\n', n = 0);

  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.games where id = gh;
  log := log || format(E'A13 organiser RLS sees hidden game: %s\n', n = 1);
  reset role;
  -- Moving the start date closer moves visible_from and publishes the game.
  perform public.update_game(gh, 'Hidden', now() + interval '10 days', now() + interval '10 days 2 hours', 'Court', 4, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  begin r := public.get_game(gh); log := log || format(E'A14 moved within 2 weeks -> visible, no visible_from for player: %s\n', r->'game'->>'visible_from' is null);
  exception when others then log := log || format(E'A14 moved within 2 weeks -> visible: false (%s)\n', sqlerrm); end;

  -- A visible game with players can't be hidden again.
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  gv := public.create_game(grp, 'Visible', now() + interval '20 days', now() + interval '20 days 2 hours', 'Court', 4, '');
  select visible_from is null and visibility = 'now' into strict t from public.games where id = gv;
  log := log || format(E'A15 old 7-argument call defaults to visible now: %s\n', t);
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  perform public.join_game(gv);
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  begin perform public.update_game(gv, 'Visible', now() + interval '20 days', now() + interval '20 days 2 hours', 'Court', 4, '', 'two_weeks_before');
    log := log || E'A16 cannot hide game with players: false\n';
  exception when others then log := log || format(E'A16 cannot hide game with players: %s\n', sqlerrm = 'cannot_hide_game_with_players'); end;
  gv2 := public.create_game(grp, 'Empty', now() + interval '20 days', now() + interval '20 days 2 hours', 'Court', 4, '');
  perform public.update_game(gv2, 'Empty', now() + interval '20 days', now() + interval '20 days 2 hours', 'Court', 4, '', 'week_before');
  select visibility = 'week_before' and visible_from > now() into strict t from public.games where id = gv2;
  log := log || format(E'A17 game without players can be scheduled: %s\n', t);
  begin perform public.create_game(grp, 'Bad', now() + interval '20 days', now() + interval '20 days 2 hours', 'Court', 4, '', 'tomorrow');
    log := log || E'A18 invalid visibility rejected: false\n';
  exception when others then log := log || format(E'A18 invalid visibility rejected: %s\n', sqlerrm = 'invalid_visibility'); end;
  gd := public.create_game(grp, 'Soon', now() + interval '13 days', now() + interval '13 days 2 hours', 'Court', 4, '', 'two_weeks_before');
  perform set_config('request.jwt.claims', json_build_object('sub', u[2], 'role', 'authenticated')::text, true);
  begin perform public.get_game(gd); log := log || E'A19 game already inside its window is visible at once: true\n';
  exception when others then log := log || format(E'A19 game already inside its window is visible at once: false (%s)\n', sqlerrm); end;

  -- ===================== B. Fees =====================
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  gf := public.create_game(grp, 'Paid', now() + interval '3 days', now() + interval '3 days 2 hours', 'Court', 4, '');
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  begin perform public.set_game_fee(gf, 4800, 'organiser', null, '91234567'); log := log || E'B1 player cannot set fee: false\n';
  exception when others then log := log || format(E'B1 player cannot set fee: %s\n', sqlerrm = 'forbidden'); end;
  begin perform public.get_game_fee_settings(gf); log := log || E'B2 player cannot read fee settings: false\n';
  exception when others then log := log || format(E'B2 player cannot read fee settings: %s\n', sqlerrm = 'forbidden'); end;

  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  begin perform public.set_game_fee(gf, 0, 'organiser', null, '91234567'); log := log || E'B3 zero fee rejected: false\n';
  exception when others then log := log || format(E'B3 zero fee rejected: %s\n', sqlerrm = 'invalid_fee'); end;
  begin perform public.set_game_fee(gf, 4800, 'organiser', null, '91234567', 'USD'); log := log || E'B4 non-SGD rejected: false\n';
  exception when others then log := log || format(E'B4 non-SGD rejected: %s\n', sqlerrm = 'invalid_currency'); end;
  begin perform public.set_game_fee(gf, 4800, 'someone', null, '91234567'); log := log || E'B5 bad payee kind rejected: false\n';
  exception when others then log := log || format(E'B5 bad payee kind rejected: %s\n', sqlerrm = 'invalid_payee'); end;
  begin perform public.set_game_fee(gf, 4800, 'organiser', null, '+63 917 123 4567'); log := log || E'B6 non-+65 PayNow rejected: false\n';
  exception when others then log := log || format(E'B6 non-+65 PayNow rejected: %s\n', sqlerrm = 'invalid_paynow_mobile'); end;
  begin perform public.set_game_fee(gf, 4800, 'nominated', '  ', '81234567'); log := log || E'B7 nominated payee needs a name: false\n';
  exception when others then log := log || format(E'B7 nominated payee needs a name: %s\n', sqlerrm = 'invalid_payee_name'); end;

  r := public.set_game_fee(gf, 4800, 'organiser', null, '9123 4567');
  select payee_mobile into t from public.game_payees where game_id = gf;
  log := log || format(E'B8 fee saved, local number stored as +65: %s\n', r->>'changed' = 'true' and t = '+6591234567');
  r := public.get_game(gf)->'game'->'fee';
  log := log || format(E'B9 no players: total 4800, share null, share if full 1200: %s\n',
    r->>'total_cents' = '4800' and r->>'basis' = '0' and r->'share_cents' = 'null'::jsonb and r->>'share_if_full_cents' = '1200' and r->>'currency' = 'SGD');
  r := public.get_game_fee_settings(gf);
  log := log || format(E'B10 organiser fee settings include payee number: %s\n', r->'payee'->>'mobile' = '+6591234567' and r->'payee'->>'kind' = 'organiser');

  for i in 1..5 loop
    perform set_config('request.jwt.claims', json_build_object('sub', u[i], 'role', 'authenticated')::text, true);
    perform public.join_game(gf);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  r := public.get_game(gf)->'game'->'fee';
  log := log || format(E'B11 4 playing + 1 waitlist: share = 4800/4 = 1200: %s\n', r->>'basis' = '4' and r->>'share_cents' = '1200');
  log := log || format(E'B12 playing member sees payee name and number: %s\n', r->'payee'->>'mobile' = '+6591234567' and r->'payee'->>'name' = 'Fee Org');
  log := log || format(E'B13 not marked changed for a player who joined after the fee: %s\n', r->>'changed_since_join' = 'false');
  select count(*) into n from jsonb_array_elements(public.list_games(false)) e where (e->>'id')::uuid = gf and e->'fee'->>'share_cents' = '1200';
  log := log || format(E'B14 games list carries the fee summary: %s\n', n = 1);
  perform set_config('request.jwt.claims', json_build_object('sub', u[5], 'role', 'authenticated')::text, true);
  r := public.get_game(gf)->'game'->'fee';
  log := log || format(E'B15 waitlisted member sees cost but not payee: %s\n', r->>'total_cents' = '4800' and r->'payee' = 'null'::jsonb);
  perform set_config('request.jwt.claims', json_build_object('sub', u[6], 'role', 'authenticated')::text, true);
  r := public.get_game(gf)->'game'->'fee';
  log := log || format(E'B16 member not signed up sees cost but not payee: %s\n', r->>'total_cents' = '4800' and r->'payee' = 'null'::jsonb);
  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  r := public.preview_shared_game(gf);
  log := log || format(E'B17 shared-link preview carries cost without payee: %s\n', r->'fee'->>'total_cents' = '4800' and r->'fee'->'payee' is null);

  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  -- now() is fixed inside one transaction, so backdate the sign-ups to model joining before the change.
  update public.registrations set joined_at = now() - interval '1 hour' where game_id = gf;
  r := public.set_game_fee(gf, 4801, 'organiser', null, '+65 9123 4567');
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  r := public.get_game(gf)->'game'->'fee';
  log := log || format(E'B18 share rounds up to the cent (4801/4 = 1201): %s\n', r->>'share_cents' = '1201');
  log := log || format(E'B19 fee change flagged for existing players, previous kept: %s\n', r->>'changed_since_join' = 'true' and r->>'previous_cents' = '4800');
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  r := public.set_game_fee(gf, 4801, 'nominated', 'Court Keeper', '+65 8123 4567');
  log := log || format(E'B20 payee-only change is not a fee change: %s\n', r->>'changed' = 'false');
  perform set_config('request.jwt.claims', json_build_object('sub', u[2], 'role', 'authenticated')::text, true);
  r := public.get_game(gf)->'game'->'fee';
  log := log || format(E'B21 nominated payee shown by name and number: %s\n', r->'payee'->>'name' = 'Court Keeper' and r->'payee'->>'mobile' = '+6581234567');
  perform public.withdraw_game(gf);
  perform set_config('request.jwt.claims', json_build_object('sub', u[5], 'role', 'authenticated')::text, true);
  r := public.get_game(gf)->'game'->'fee';
  log := log || format(E'B22 promoted player now sees payee, basis still 4: %s\n', r->'payee'->>'mobile' = '+6581234567' and r->>'basis' = '4');
  select count(*) into n from public.audit_events where game_id = gf and action = 'fee_changed';
  log := log || format(E'B23 two fee changes logged (payee-only change not logged): %s\n', n = 2);
  select private.activity_details('fee_changed', details)::text into t from public.audit_events
   where game_id = gf and action = 'fee_changed' order by id desc limit 1;
  log := log || format(E'B24 activity log shows amounts only: %s\n', t like '%SGD 48.00%' and t like '%SGD 48.01%');
  select count(*) into n from public.audit_events where group_id = grp and (details::text like '%91234567%' or details::text like '%81234567%');
  log := log || format(E'B25 no payee number in the audit log: %s\n', n = 0);

  -- ===================== C. Slot confirmation =====================
  day_end := ((now() at time zone 'Asia/Singapore')::date + 1)::timestamp at time zone 'Asia/Singapore';
  ts := now() + (day_end - now()) / 2; -- later today (group time), always in the future
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  gc := public.create_game(grp, 'Today', ts, ts + interval '2 hours', 'Court', 2, '');
  perform public.set_game_fee(gc, 3000, 'organiser', null, '91234567');
  gfree := public.create_game(grp, 'Free today', ts, ts + interval '2 hours', 'Court', 2, '');
  gt := public.create_game(grp, 'Tomorrow', day_end + interval '12 hours', day_end + interval '14 hours', 'Court', 2, '');
  perform public.set_game_fee(gt, 3000, 'organiser', null, '91234567');
  for i in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', u[i], 'role', 'authenticated')::text, true);
    perform public.join_game(gc); perform public.join_game(gfree); perform public.join_game(gt);
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  r := public.get_game(gc)->'confirmation';
  log := log || format(E'C1 playing member: confirmation required and open: %s\n', r->>'required' = 'true' and r->>'open' = 'true' and r->'confirmed_at' = 'null'::jsonb);
  log := log || format(E'C2 window opens 00:00 game day: %s\n',
    (r->>'opens_at')::timestamptz = (((ts at time zone 'Asia/Singapore')::date)::timestamp at time zone 'Asia/Singapore') and (r->>'closes_at')::timestamptz = ts);
  r := public.confirm_slot(gc, '+63 917 123 4567');
  select mobile into t from public.slot_confirmations where game_id = gc and user_id = u[1];
  log := log || format(E'C3 international number accepted and normalised: %s\n', t = '+639171234567' and r->>'confirmed_at' is not null);
  r := public.get_game(gc)->'confirmation';
  log := log || format(E'C4 player sees confirmed_at: %s\n', r->>'confirmed_at' is not null);
  begin perform public.confirm_slot(gfree, '+6591234567'); log := log || E'C5 free game needs no confirmation: false\n';
  exception when others then log := log || format(E'C5 free game needs no confirmation: %s\n', sqlerrm = 'confirmation_not_needed'); end;
  log := log || format(E'C6 free game has no confirmation block: %s\n', public.get_game(gfree)->'confirmation' = 'null'::jsonb);
  begin perform public.confirm_slot(gt, '+6591234567'); log := log || E'C7 not open before game day: false\n';
  exception when others then log := log || format(E'C7 not open before game day: %s\n', sqlerrm = 'confirmation_not_open'); end;
  log := log || format(E'C8 tomorrow: open=false: %s\n', public.get_game(gt)->'confirmation'->>'open' = 'false');

  perform set_config('request.jwt.claims', json_build_object('sub', u[2], 'role', 'authenticated')::text, true);
  begin perform public.confirm_slot(gc, 'abc'); log := log || E'C9 invalid number rejected: false\n';
  exception when others then log := log || format(E'C9 invalid number rejected: %s\n', sqlerrm = 'invalid_mobile'); end;
  begin perform public.confirm_slot(gc, '91234567'); log := log || E'C10 number without country code rejected: false\n';
  exception when others then log := log || format(E'C10 number without country code rejected: %s\n', sqlerrm = 'invalid_mobile'); end;
  perform public.confirm_slot(gc, '0065 9876 5432');
  select mobile into t from public.slot_confirmations where game_id = gc and user_id = u[2];
  log := log || format(E'C11 00 prefix accepted: %s\n', t = '+6598765432');
  perform public.confirm_slot(gc, '+65 9876 0000');
  select count(*), max(mobile) into n, t from public.slot_confirmations where game_id = gc and user_id = u[2];
  log := log || format(E'C12 confirming again updates the number: %s\n', n = 1 and t = '+6598760000');

  perform set_config('request.jwt.claims', json_build_object('sub', u[3], 'role', 'authenticated')::text, true);
  begin perform public.confirm_slot(gc, '+6591112222'); log := log || E'C13 waitlisted cannot confirm: false\n';
  exception when others then log := log || format(E'C13 waitlisted cannot confirm: %s\n', sqlerrm = 'not_playing'); end;
  log := log || format(E'C14 waitlisted: required=false: %s\n', public.get_game(gc)->'confirmation'->>'required' = 'false');
  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  begin perform public.confirm_slot(gc, '+6591112222'); log := log || E'C15 outsider cannot confirm: false\n';
  exception when others then log := log || format(E'C15 outsider cannot confirm: %s\n', sqlerrm = 'not_member'); end;

  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  begin perform public.list_slot_confirmations(gc); log := log || E'C16 player cannot list confirmations: false\n';
  exception when others then log := log || format(E'C16 player cannot list confirmations: %s\n', sqlerrm = 'forbidden'); end;
  set local role authenticated;
  begin select count(*) into n from public.slot_confirmations; log := log || E'C17 no direct table access to confirmations: false\n';
  exception when insufficient_privilege then log := log || E'C17 no direct table access to confirmations: true\n'; end;
  begin select count(*) into n from public.game_payees; log := log || E'C18 no direct table access to payees: false\n';
  exception when insufficient_privilege then log := log || E'C18 no direct table access to payees: true\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  r := public.list_slot_confirmations(gc);
  log := log || format(E'C19 organiser list: 2 playing, both numbers: %s\n', jsonb_array_length(r) = 2
    and r->0->>'mobile' = '+639171234567' and r->1->>'mobile' = '+6598760000');
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  log := log || format(E'C20 admin can list confirmations: %s\n', jsonb_array_length(public.list_slot_confirmations(gc)) = 2);

  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  perform public.withdraw_game(gc);
  select count(*) into n from public.slot_confirmations where game_id = gc and user_id = u[1];
  log := log || format(E'C21 withdrawing deletes the confirmation: %s\n', n = 0);
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  r := public.list_slot_confirmations(gc);
  log := log || format(E'C22 promoted player listed as unconfirmed: %s\n', jsonb_array_length(r) = 2
    and exists (select 1 from jsonb_array_elements(r) e where (e->>'user_id')::uuid = u[3] and e->'mobile' = 'null'::jsonb));
  select count(*) into n from public.audit_events where game_id = gc and action = 'slot_confirmed';
  log := log || format(E'C23 confirmations logged: %s\n', n = 3);
  select count(*) into n from public.audit_events where group_id = grp and (details::text like '%9171234567%' or details::text like '%98760000%');
  log := log || format(E'C24 no confirmation number in the audit log: %s\n', n = 0);

  r := public.set_game_fee(gc, null);
  select count(*) into n from public.slot_confirmations where game_id = gc;
  select count(*) + n into n from public.game_payees where game_id = gc;
  log := log || format(E'C25 removing the fee deletes payee and confirmations: %s\n', r->>'changed' = 'true' and n = 0);
  r := public.get_game(gc);
  log := log || format(E'C26 game without fee: no fee, no confirmation: %s\n', r->'game'->'fee' = 'null'::jsonb and r->'confirmation' = 'null'::jsonb);

  -- Started game: confirmation closed.
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no, fee_total_cents)
  values (grp, 'Started', now() - interval '10 minutes', now() + interval '110 minutes', 4, org, 2, 2000) returning id into gs;
  insert into public.registrations (game_id, user_id, queue_no, joined_at) values (gs, u[1], 1, now() - interval '1 day');
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  begin perform public.confirm_slot(gs, '+6591234567'); log := log || E'C27 closed at start time: false\n';
  exception when others then log := log || format(E'C27 closed at start time: %s\n', sqlerrm = 'confirmation_closed'); end;

  -- ===================== D. Final share =====================
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no)
  values (grp, 'Played', now() - interval '3 hours', now() - interval '1 hour', 6, org, 5) returning id into gp;
  insert into public.registrations (game_id, user_id, queue_no, joined_at)
  select gp, u[k], k, now() - interval '1 day' from generate_series(1, 4) k;
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  perform public.set_game_fee(gp, 6000, 'organiser', null, '91234567');
  perform public.get_game_attendance(gp); -- captures the 4 players at the start
  insert into public.registrations (game_id, user_id, queue_no, joined_at) values (gp, u[5], 5, now() - interval '2 hours'); -- late joiner
  -- Late joiners are added to attendance while the game is in progress (sync_late_attendance); simulate that here.
  insert into public.game_attendance (game_id, user_id) values (gp, u[5]) on conflict do nothing;
  select count(*) into n from public.game_attendance where game_id = gp;
  log := log || format(E'D1 attendance: 4 at start + 1 late joiner: %s\n', n = 5);
  r := public.get_game(gp)->'game'->'fee';
  log := log || format(E'D2 not final while players are unmarked: %s\n', r->>'final' = 'false' and r->>'basis' = '5');
  perform public.mark_game_attendance(gp, u[1], 'present');
  perform public.mark_game_attendance(gp, u[2], 'no_show');
  perform public.mark_game_attendance(gp, u[3], 'excused');
  perform public.mark_game_attendance(gp, u[4], 'present');
  perform public.mark_game_attendance(gp, u[5], 'present');
  r := public.get_game(gp)->'game'->'fee';
  log := log || format(E'D3 final share: 5 on list - 1 excused = 4, 6000/4 = 1500: %s\n', r->>'final' = 'true' and r->>'basis' = '4' and r->>'share_cents' = '1500');
  perform set_config('request.jwt.claims', json_build_object('sub', u[2], 'role', 'authenticated')::text, true);
  r := public.get_game(gp)->'game'->'fee';
  log := log || format(E'D4 unexcused no-show still sees payee: %s\n', r->'payee'->>'mobile' = '+6591234567');

  -- ===================== E. 30-day purge =====================
  insert into public.games (group_id, title, starts_at, ends_at, capacity, created_by, next_queue_no, fee_total_cents)
  values (grp, 'Old', now() - interval '32 days', now() - interval '31 days 22 hours', 4, org, 2, 2000) returning id into gold;
  insert into public.slot_confirmations (game_id, user_id, mobile) values (gold, u[1], '+6591234567'), (gs, u[1], '+6591234567');
  n := private.purge_slot_confirmations();
  log := log || format(E'E1 purge removes confirmations for games ended over 30 days ago: %s\n',
    n >= 1 and not exists (select 1 from public.slot_confirmations where game_id = gold));
  log := log || format(E'E2 recent confirmations kept: %s\n', exists (select 1 from public.slot_confirmations where game_id = gs));

  select count(*) filter (where l ~ ': (t|true)$'), count(*) filter (where l <> '' and l !~ ': (t|true)$'),
         coalesce(string_agg(l, ' | ') filter (where l <> '' and l !~ ': (t|true)$'), 'none')
    into i, n, t from unnest(string_to_array(log, E'\n')) l;
  if n > 0 then
    raise exception 'RESULTS passed=% failed=% failing=[%]%', i, n, t, E'\n' || log;
  end if;
  raise notice 'FR-021 scheduled games and fees: RESULTS passed=% failed=0', i;
end $$;
rollback;
