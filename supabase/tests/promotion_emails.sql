-- FR-004 promotion email pipeline tests (always rolled back via final exception).
do $$
declare
  u uuid[] := '{}'; admin uuid := gen_random_uuid(); grp uuid; game uuid; i int; r jsonb; log text := '';
  sec text; n int; st text;
begin
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'pickleme_outbox_secret';
  insert into auth.users (id, email, aud, role) values (admin, 'adm@test.local', 'authenticated', 'authenticated');
  for i in 1..4 loop
    u := u || gen_random_uuid();
    insert into auth.users (id, email, aud, role) values (u[i], 'p'||i||'@test.local', 'authenticated', 'authenticated');
  end loop;
  select id into grp from public.groups where name = 'Tuesday Socials @CBP1';
  insert into public.group_members (group_id, user_id, role) values (grp, admin, 'admin');
  for i in 1..4 loop
    insert into public.group_members (group_id, user_id) values (grp, u[i]);
    insert into public.profiles (user_id, display_name) values (u[i], 'P' || i);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  game := public.create_game(grp, 'Email Test', now() + interval '1 day', now() + interval '1 day 2 hours', 'CBP1', 1, '');
  for i in 1..4 loop
    perform set_config('request.jwt.claims', json_build_object('sub', u[i], 'role', 'authenticated')::text, true);
    perform public.join_game(game);
  end loop;

  -- P1 withdraws -> P2 promoted -> claim returns P2
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  perform public.withdraw_game(game);
  r := public.claim_promotion_emails(sec, 20);
  log := log || format(E'E1 claim returns P2 with email & position 1: %s\n',
    jsonb_array_length(r) = 1 and r->0->>'email' = 'p2@test.local' and r->0->>'position' = '1' and r->0->>'title' = 'Email Test');
  perform public.complete_promotion_email(sec, (r->0->>'id')::bigint, true, null, 'msg_123');
  select status into st from public.notification_outbox where id = (r->0->>'id')::bigint;
  log := log || format(E'E2 marked sent: %s\n', st = 'sent');
  r := public.claim_promotion_emails(sec, 20);
  log := log || format(E'E3 nothing left to claim (no duplicates): %s\n', jsonb_array_length(r) = 0);

  -- P2 withdraws -> P3 promoted, but P3 withdraws before the email goes out -> skipped
  perform set_config('request.jwt.claims', json_build_object('sub', u[2], 'role', 'authenticated')::text, true);
  perform public.withdraw_game(game);
  perform set_config('request.jwt.claims', json_build_object('sub', u[3], 'role', 'authenticated')::text, true);
  perform public.withdraw_game(game);   -- this also promotes P4
  r := public.claim_promotion_emails(sec, 20);
  select status into st from public.notification_outbox o join public.registrations g on g.id = o.registration_id where g.user_id = u[3];
  log := log || format(E'E4 P3 skipped (withdrew first): %s; only P4 claimed: %s\n', st = 'skipped',
    jsonb_array_length(r) = 1 and r->0->>'email' = 'p4@test.local');

  -- failure path for P4 -> retry later with backoff
  perform public.complete_promotion_email(sec, (r->0->>'id')::bigint, false, 'Resend 500');
  select status || ':' || attempts || ':' || (next_attempt_at > now()) into st from public.notification_outbox where id = (r->0->>'id')::bigint;
  log := log || format(E'E5 failed send -> pending, attempt 1, retry scheduled: %s (%s)\n', st = 'pending:1:true', st);
  r := public.claim_promotion_emails(sec, 20);
  log := log || format(E'E6 not re-claimed before backoff: %s\n', jsonb_array_length(r) = 0);
  update public.notification_outbox set next_attempt_at = now() - interval '1 second' where user_id = u[4];
  r := public.claim_promotion_emails(sec, 20);
  log := log || format(E'E7 re-claimed after backoff: %s\n', jsonb_array_length(r) = 1);
  perform public.release_promotion_emails(sec, array[(r->0->>'id')::bigint], 'no key');
  select status || ':' || attempts into st from public.notification_outbox where id = (r->0->>'id')::bigint;
  log := log || format(E'E8 release returns to pending without using an attempt: %s (%s)\n', st = 'pending:1', st);

  -- cancelled game -> skipped
  update public.notification_outbox set next_attempt_at = now() - interval '1 second' where user_id = u[4];
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  perform public.set_game_status(game, 'cancelled');
  r := public.claim_promotion_emails(sec, 20);
  select skipped_reason into st from public.notification_outbox where user_id = u[4];
  log := log || format(E'E9 cancelled game -> skipped (%s), none claimed: %s\n', st, jsonb_array_length(r) = 0 and st = 'game_cancelled');

  -- security
  begin perform public.claim_promotion_emails('wrong', 5); log := log || E'E10 wrong secret blocked: false\n';
  exception when others then log := log || format(E'E10 wrong secret blocked: %s\n', sqlerrm = 'forbidden'); end;
  set local role authenticated;
  begin select count(*) into n from public.notification_outbox; log := log || format(E'E11 players cannot read outbox: %s\n', n = 0);
  exception when others then log := log || format(E'E11 players cannot read outbox: true (%s)\n', sqlstate); end;
  reset role;
  select count(*) into n from net.http_request_queue;
  log := log || format(E'E12 trigger queued edge-function calls: %s (%s)\n', n > 0, n);

  raise exception 'RESULTS%', E'\n' || log;
end $$;
