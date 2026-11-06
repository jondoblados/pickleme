-- Integration tests for FR-017 game weather. Fixtures roll back.
begin;
create or replace function private.outbox_secret_ok(p_secret text) returns boolean language sql as $$ select p_secret = 'test-secret' $$;

-- Open-Meteo-shaped fixture: 3 days of hourly data from today (Asia/Singapore).
create function pg_temp.fixture(p_tz text default 'Asia/Singapore', p_temp numeric default 27) returns jsonb language sql as $$
  with h as (select to_char(t, 'YYYY-MM-DD"T"HH24:MI') as t, extract(hour from t)::int as hr
             from generate_series((now() at time zone 'Asia/Singapore')::date::timestamp,
                                  (now() at time zone 'Asia/Singapore')::date::timestamp + interval '71 hours',
                                  interval '1 hour') t),
       d as (select to_char(t, 'YYYY-MM-DD') as t from generate_series((now() at time zone 'Asia/Singapore')::date::timestamp,
                                  (now() at time zone 'Asia/Singapore')::date::timestamp + interval '2 days', interval '1 day') t)
  select jsonb_build_object('latitude', 1.37, 'longitude', 103.94, 'generationtime_ms', 0.2,
    'utc_offset_seconds', 28800, 'timezone', p_tz, 'elevation', 3,
    'hourly_units', jsonb_build_object('time', 'iso8601', 'temperature_2m', '°C', 'weather_code', 'wmo code',
        'precipitation_probability', '%', 'precipitation', 'mm', 'wind_speed_10m', 'km/h', 'is_day', ''),
    'hourly', jsonb_build_object(
      'time', (select jsonb_agg(t order by t) from h),
      'temperature_2m', (select jsonb_agg(p_temp + hr / 10.0 order by t) from h),
      'weather_code', (select jsonb_agg(case when hr between 15 and 17 then 95 else 3 end order by t) from h),
      'precipitation_probability', (select jsonb_agg(hr * 4 order by t) from h),
      'precipitation', (select jsonb_agg(0.1 order by t) from h),
      'wind_speed_10m', (select jsonb_agg(9.5 order by t) from h),
      'is_day', (select jsonb_agg(case when hr between 7 and 18 then 1 else 0 end order by t) from h)),
    'daily_units', jsonb_build_object('time', 'iso8601'),
    'daily', jsonb_build_object('time', (select jsonb_agg(t order by t) from d),
      'weather_code', (select jsonb_agg(95) from d), 'temperature_2m_max', (select jsonb_agg(31) from d),
      'temperature_2m_min', (select jsonb_agg(24) from d), 'precipitation_probability_max', (select jsonb_agg(88) from d),
      'precipitation_sum', (select jsonb_agg(4.2) from d)));
$$;

do $$
declare adm uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); ply uuid:=gen_random_uuid(); out uuid:=gen_random_uuid();
  g1 uuid:=gen_random_uuid(); g2 uuid:=gen_random_uuid();
  tomorrow date := (now() at time zone 'Asia/Singapore')::date + 1;
  game_a uuid; game_b uuid; game_far uuid; game_other uuid; game_cxl uuid;
  res jsonb; claimed jsonb; n int; checks int := 0; fid bigint; t0 timestamptz; t1 timestamptz;
  w record;
begin
  -- ---------- Window arithmetic (pure) ----------
  select * into w from private.weather_window('2026-11-10 11:00+00', '2026-11-10 13:00+00', 'Asia/Singapore'); -- 19:00–21:00 SGT
  if w.game_date <> '2026-11-10' or w.active_from <> '2026-11-08 16:00+00' or w.active_until <> '2026-11-10 16:00+00' then
    raise exception 'window normal: %', w; end if; checks := checks + 1;
  select * into w from private.weather_window('2026-11-10 15:30+00', '2026-11-10 17:00+00', 'Asia/Singapore'); -- 23:30–01:00 SGT
  if w.game_date <> '2026-11-10' or w.active_until <> '2026-11-10 18:00+00' then raise exception 'window overnight: %', w; end if;
  checks := checks + 1;
  if private.location_key('  CBP1   L6  Multi-purpose Courts ') <> 'cbp1 l6 multi-purpose courts'
     or private.location_key('   ') is not null then raise exception 'location_key'; end if; checks := checks + 1;

  -- ---------- Fixtures ----------
  insert into auth.users(id,email,aud,role,email_confirmed_at) values
    (adm,'adm@fr017.invalid','authenticated','authenticated',now()), (org,'org@fr017.invalid','authenticated','authenticated',now()),
    (ply,'ply@fr017.invalid','authenticated','authenticated',now()), (out,'out@fr017.invalid','authenticated','authenticated',now());
  insert into public.profiles(user_id,display_name) values (adm,'Admin'),(org,'Org'),(ply,'Player'),(out,'Outsider');
  insert into public.groups(id,name) values (g1,'G1'),(g2,'G2');
  insert into public.group_members(group_id,user_id,role) values (g1,adm,'admin'),(g1,org,'organiser'),(g1,ply,'player'),(g2,out,'admin');
  insert into public.games(group_id,title,starts_at,ends_at,location,capacity) values
    (g1,'A',(tomorrow + time '19:00') at time zone 'Asia/Singapore',(tomorrow + time '21:00') at time zone 'Asia/Singapore','CBP1 L6 Multi-purpose Courts',16)
    returning id into game_a;
  insert into public.games(group_id,title,starts_at,ends_at,location,capacity) values
    (g1,'B',(tomorrow + time '07:30') at time zone 'Asia/Singapore',(tomorrow + time '09:00') at time zone 'Asia/Singapore','cbp1  l6 multi-purpose courts',16)
    returning id into game_b;
  insert into public.games(group_id,title,starts_at,ends_at,location,capacity) values
    (g1,'Far',(tomorrow + 3 + time '19:00') at time zone 'Asia/Singapore',(tomorrow + 3 + time '21:00') at time zone 'Asia/Singapore','CBP1 L6 Multi-purpose Courts',16)
    returning id into game_far;
  insert into public.games(group_id,title,starts_at,ends_at,location,capacity,status) values
    (g1,'Cxl',(tomorrow + time '10:00') at time zone 'Asia/Singapore',(tomorrow + time '11:00') at time zone 'Asia/Singapore','TSA @Expo Hall 10',16,'cancelled')
    returning id into game_cxl;
  insert into public.games(group_id,title,starts_at,ends_at,location,capacity) values
    (g2,'Other',(tomorrow + time '19:00') at time zone 'Asia/Singapore',(tomorrow + time '21:00') at time zone 'Asia/Singapore','Somewhere',16)
    returning id into game_other;

  -- ---------- Client privileges ----------
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',json_build_object('sub',ply,'role','authenticated')::text,true);
  begin perform 1 from public.weather_venues; raise exception 'venues readable';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin perform 1 from private.weather_fetches; raise exception 'cache readable';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin perform public.claim_weather_fetches('test-secret'); raise exception 'authenticated can claim';
  exception when insufficient_privilege then checks := checks + 1; end;

  -- Not configured yet; players see that, cannot configure
  res := public.get_game_weather(game_a);
  if res->>'state' <> 'not_configured' or (res->>'can_manage')::boolean then raise exception 'unconfigured: %', res; end if;
  checks := checks + 1;
  begin perform public.save_weather_venue(game_a, 'X', 1.3, 103.9); raise exception 'player saved venue';
  exception when insufficient_privilege then checks := checks + 1; end;

  -- Outsider cannot read another group's game weather
  perform set_config('request.jwt.claims',json_build_object('sub',out,'role','authenticated')::text,true);
  begin perform public.get_game_weather(game_a); raise exception 'outsider read weather';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin perform public.save_weather_venue(game_a, 'X', 1.3, 103.9); raise exception 'outsider saved venue';
  exception when insufficient_privilege then checks := checks + 1; end;

  -- Organiser confirms the venue: validation, then success + audit
  perform set_config('request.jwt.claims',json_build_object('sub',org,'role','authenticated')::text,true);
  begin perform public.save_weather_venue(game_a, '  ', 1.3, 103.9); raise exception 'blank address';
  exception when invalid_parameter_value then checks := checks + 1; end;
  begin perform public.save_weather_venue(game_a, 'X', 91, 103.9); raise exception 'bad latitude';
  exception when invalid_parameter_value then checks := checks + 1; end;
  res := public.save_weather_venue(game_a, '1 Changi Business Park Crescent, Singapore 486025', 1.333351, 103.965669);
  if res->>'address' is null then raise exception 'save: %', res; end if; checks := checks + 1;
  reset role;
  if (select count(*) from public.audit_events where game_id = game_a and action = 'weather_venue_set' and actor_id = org) <> 1
    then raise exception 'audit missing'; end if; checks := checks + 1;

  -- ---------- Eligibility ----------
  t0 := (tomorrow - 1)::timestamp at time zone 'Asia/Singapore';   -- 00:00 day before
  if not exists (select 1 from private.weather_eligible(t0) where game_id = game_a) then raise exception 'not eligible at 00:00 day before'; end if;
  if exists (select 1 from private.weather_eligible(t0 - interval '1 second') where game_id = game_a) then raise exception 'eligible too early'; end if;
  t1 := (tomorrow + 1)::timestamp at time zone 'Asia/Singapore';   -- 24:00 game date
  if exists (select 1 from private.weather_eligible(t1) where game_id = game_a) then raise exception 'eligible after game date'; end if;
  if not exists (select 1 from private.weather_eligible(t1 - interval '1 second') where game_id = game_a) then raise exception 'not eligible late game day'; end if;
  if exists (select 1 from private.weather_eligible(now()) where game_id in (game_far, game_cxl, game_other)) then
    raise exception 'far/cancelled/unconfigured eligible'; end if;
  checks := checks + 1;

  -- ---------- Worker: secret, shared claim, no duplicates ----------
  begin perform public.claim_weather_fetches('wrong'); raise exception 'wrong secret accepted';
  exception when insufficient_privilege then checks := checks + 1; end;
  claimed := public.claim_weather_fetches('test-secret');
  if jsonb_array_length(claimed) <> 1 then raise exception 'expected one shared claim for A+B, got %', claimed; end if;
  checks := checks + 1;
  fid := (claimed->0->>'id')::bigint;
  if jsonb_array_length(public.claim_weather_fetches('test-secret')) <> 0 then raise exception 'duplicate claim in same hour'; end if;
  checks := checks + 1;

  -- Pending: configured, no forecast yet
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',json_build_object('sub',ply,'role','authenticated')::text,true);
  res := public.get_game_weather(game_a);
  if res->>'state' <> 'configured' or res->'forecast' <> 'null'::jsonb then raise exception 'pending: %', res; end if;
  checks := checks + 1;
  reset role;

  -- Invalid payloads fail; a wrong-unit payload fails
  if not public.complete_weather_fetch('test-secret', fid, pg_temp.fixture() - 'hourly', null) then raise exception 'complete returned false'; end if;
  if (select status from private.weather_fetches where id = fid) <> 'failed' then raise exception 'invalid payload stored'; end if;
  checks := checks + 1;
  if public.complete_weather_fetch('test-secret', fid, pg_temp.fixture(), null) then raise exception 'completed twice'; end if;
  checks := checks + 1;
  if private.weather_payload_ok(jsonb_set(pg_temp.fixture(), '{hourly_units,temperature_2m}', '"°F"'), 'Asia/Singapore')
     or private.weather_payload_ok(pg_temp.fixture('UTC'), 'Asia/Singapore')
     or not private.weather_payload_ok(pg_temp.fixture(), 'Asia/Singapore') then raise exception 'payload validation'; end if;
  checks := checks + 1;

  -- Previous hour succeeded; the failed current hour must not hide it
  insert into private.weather_fetches (coord_key, latitude, longitude, timezone, slot_hour, status, completed_at, payload)
  select coord_key, latitude, longitude, timezone, slot_hour - interval '1 hour', 'succeeded', now() - interval '50 minutes',
         pg_temp.fixture() - 'generationtime_ms' from private.weather_fetches where id = fid;

  perform set_config('role','authenticated',true);
  res := public.get_game_weather(game_a);
  if res->'forecast' = 'null'::jsonb then raise exception 'previous success hidden: %', res; end if;
  if not (res->>'last_attempt_failed')::boolean then raise exception 'failure not flagged'; end if;
  -- Whole game date (00:00..24:00 inclusive) = 25 hourly points; daily summary for the game date
  n := jsonb_array_length(res->'forecast'->'hours');
  if n <> 25 then raise exception 'expected 25 hours, got %', n; end if;
  if res->'forecast'->'day'->>'date' <> tomorrow::text or (res->'forecast'->'day'->>'pop_max')::int <> 88 then
    raise exception 'day summary: %', res->'forecast'->'day'; end if;
  if (res->'forecast'->'hours'->0->>'t')::timestamptz <> (tomorrow::timestamp at time zone 'Asia/Singapore') then
    raise exception 'first hour %', res->'forecast'->'hours'->0; end if;
  if (res->'forecast'->'hours'->19->>'pop')::int <> 76 or (res->'forecast'->'hours'->16->>'code')::int <> 95 then
    raise exception 'hour values shifted: %', res->'forecast'->'hours'->19; end if;
  if res->'venue'->>'address' not like '1 Changi Business Park%' or res ? 'group_id' then raise exception 'venue: %', res; end if;
  checks := checks + 1;

  -- Second game at the same (normalised) location shares the venue and forecast
  res := public.get_game_weather(game_b);
  if res->'forecast' = 'null'::jsonb then raise exception 'shared forecast missing for B'; end if;
  checks := checks + 1;

  -- Cancelled game reports cancelled (configured location)
  perform set_config('request.jwt.claims',json_build_object('sub',org,'role','authenticated')::text,true);
  perform public.save_weather_venue(game_cxl, '1 Expo Drive, Singapore 486150', 1.334402, 103.96036);
  res := public.get_game_weather(game_cxl);
  if res->>'state' <> 'cancelled' then raise exception 'cancelled state: %', res->>'state'; end if;
  checks := checks + 1;
  reset role;

  -- Location edit: the venue no longer matches
  update public.games set location = 'Somewhere else' where id = game_b;
  perform set_config('role','authenticated',true);
  res := public.get_game_weather(game_b);
  if res->>'state' <> 'not_configured' or not (res->>'can_manage')::boolean then raise exception 'after edit: %', res; end if;
  checks := checks + 1;
  reset role;
  update public.games set location = '' where id = game_b;
  perform set_config('role','authenticated',true);
  if public.get_game_weather(game_b)->>'state' <> 'no_location' then raise exception 'no_location'; end if;
  checks := checks + 1;

  -- Remove venue (organiser), audit recorded
  if not public.remove_weather_venue(game_a) then raise exception 'remove'; end if;
  if public.get_game_weather(game_a)->>'state' <> 'not_configured' then raise exception 'still configured'; end if;
  reset role;
  if not exists (select 1 from public.audit_events where game_id = game_a and action = 'weather_venue_removed') then
    raise exception 'remove audit'; end if;
  checks := checks + 1;

  -- Abandoned claim: retried once after 10 minutes, never more
  update private.weather_fetches set status = 'claimed', completed_at = null, error = null,
    claimed_at = now() - interval '11 minutes' where id = fid;
  perform set_config('request.jwt.claims',json_build_object('sub',org,'role','authenticated')::text,true);
  perform public.save_weather_venue(game_a, '1 Changi Business Park Crescent, Singapore 486025', 1.333351, 103.965669);
  claimed := public.claim_weather_fetches('test-secret');
  if jsonb_array_length(claimed) <> 1 or (claimed->0->>'id')::bigint <> fid then raise exception 'reclaim: %', claimed; end if;
  update private.weather_fetches set claimed_at = now() - interval '11 minutes' where id = fid;
  if jsonb_array_length(public.claim_weather_fetches('test-secret')) <> 0 then raise exception 'reclaimed twice'; end if;
  checks := checks + 1;
  if not public.complete_weather_fetch('test-secret', fid, pg_temp.fixture(), null) then raise exception 'complete after reclaim'; end if;
  if (select status from private.weather_fetches where id = fid) <> 'succeeded' then raise exception 'not succeeded'; end if;
  if (select payload ? 'generationtime_ms' from private.weather_fetches where id = fid) then raise exception 'provider timing kept'; end if;
  checks := checks + 1;

  raise notice 'FR-017 game weather: % checks passed', checks;
end $$;
rollback;
