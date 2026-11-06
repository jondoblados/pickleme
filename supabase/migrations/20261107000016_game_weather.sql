-- FR-017: weather forecasts for games at confirmed venues.
--
-- Design (see docs/fr017-weather.md):
--  * The forecast location is the game's own location text. An organiser/admin confirms the address and
--    coordinates for that text once (public.weather_venues); every game in the group with the same
--    location then shares it. Editing a game's location changes its key, so stale venues stop matching.
--  * An hourly job (pg_cron -> Edge Function `weather-fetch`) fetches one forecast per venue coordinate
--    per hour, only while at least one non-cancelled game is in its window: 00:00 on the calendar day
--    before the game (group timezone) until the later of the end of the game date and one hour after
--    the game ends. Forecasts are cached server-side and shared by every game and player.
--  * Browsers only read the cache through get_game_weather; opening a game never calls the provider.
--  * No member, group or game details are sent to the provider — only coordinates and the timezone.
--  * The schedule itself is NOT created here; see supabase/rollout/fr017_enable_weather_schedule.sql.

-- ---------- 1. Location key: the game's location text, normalised ----------
create or replace function private.location_key(p_location text)
returns text language sql immutable set search_path = '' as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_location, '')), '\s+', ' ', 'g')), '');
$$;
revoke all on function private.location_key(text) from public, anon, authenticated;

-- ---------- 2. Confirmed venues (per group, per location text) ----------
create table public.weather_venues (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  location_key  text not null check (char_length(location_key) between 1 and 120),
  location_text text not null check (char_length(location_text) between 1 and 120),
  address       text not null check (char_length(btrim(address)) between 1 and 200),
  latitude      numeric(9, 6) not null check (latitude between -90 and 90),
  longitude     numeric(9, 6) not null check (longitude between -180 and 180),
  confirmed_by  uuid references auth.users (id) on delete set null,
  confirmed_at  timestamptz not null default now(),
  unique (group_id, location_key)
);
-- Clients never read this table directly; get_game_weather exposes what a member may see.
revoke all on public.weather_venues from public, anon, authenticated;
alter table public.weather_venues enable row level security;

-- ---------- 3. Forecast cache: one row per coordinate per hourly slot ----------
create table private.weather_fetches (
  id           bigint generated always as identity primary key,
  coord_key    text not null,
  latitude     numeric(9, 6) not null,
  longitude    numeric(9, 6) not null,
  timezone     text not null,
  slot_hour    timestamptz not null,
  status       text not null default 'claimed' check (status in ('claimed', 'succeeded', 'failed')),
  attempts     int not null default 1,
  claimed_at   timestamptz not null default now(),
  completed_at timestamptz,
  error        text,
  payload      jsonb,
  unique (coord_key, slot_hour),
  check ((status = 'succeeded') = (payload is not null))
);
create index weather_fetches_success_idx on private.weather_fetches (coord_key, slot_hour desc) where status = 'succeeded';
revoke all on private.weather_fetches from public, anon, authenticated;

-- Shared by every game whose venue rounds to the same point (~100 m) in the same timezone.
create or replace function private.weather_coord_key(p_lat numeric, p_lon numeric, p_tz text)
returns text language sql immutable set search_path = '' as $$
  select round(p_lat, 3)::text || ',' || round(p_lon, 3)::text || ',' || p_tz;
$$;

-- ---------- 4. Which games are in their refresh window ----------
-- active_from:  00:00 on the day before the game date (group timezone)
-- active_until: the later of 24:00 on the game date and one hour after the game ends
create or replace function private.weather_window(p_starts timestamptz, p_ends timestamptz, p_tz text,
  out active_from timestamptz, out active_until timestamptz, out game_date date)
language sql immutable set search_path = '' as $$
  select ((d - 1)::timestamp at time zone p_tz),
         greatest(((d + 1)::timestamp at time zone p_tz), p_ends + interval '1 hour'),
         d
  from (select (p_starts at time zone p_tz)::date as d) x;
$$;

create or replace function private.weather_eligible(p_now timestamptz)
returns table (game_id uuid, latitude numeric, longitude numeric, timezone text)
language sql stable security definer set search_path = '' as $$
  select g.id, v.latitude, v.longitude, gr.timezone
  from public.games g
  join public.groups gr on gr.id = g.group_id
  join public.weather_venues v on v.group_id = g.group_id and v.location_key = private.location_key(g.location)
  cross join lateral private.weather_window(g.starts_at, g.ends_at, gr.timezone) w
  where g.status <> 'cancelled' and p_now >= w.active_from and p_now < w.active_until;
$$;
revoke all on function private.weather_window(timestamptz, timestamptz, text),
                       private.weather_eligible(timestamptz),
                       private.weather_coord_key(numeric, numeric, text) from public, anon, authenticated;

-- ---------- 5. Payload validation (the Edge Function also validates before sending) ----------
create or replace function private.weather_payload_ok(p jsonb, p_tz text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare n int; k text;
begin
  if jsonb_typeof(p) is distinct from 'object' or p->>'timezone' is distinct from p_tz
     or jsonb_typeof(p->'utc_offset_seconds') is distinct from 'number'
     or jsonb_typeof(p->'hourly') is distinct from 'object' or jsonb_typeof(p->'daily') is distinct from 'object'
     or jsonb_typeof(p->'hourly'->'time') is distinct from 'array' or jsonb_typeof(p->'daily'->'time') is distinct from 'array' then
    return false;
  end if;
  n := jsonb_array_length(p->'hourly'->'time');
  if n is null or n < 24 or n > 400 then return false; end if;
  foreach k in array array['temperature_2m', 'weather_code', 'precipitation_probability', 'precipitation',
                           'wind_speed_10m', 'is_day'] loop
    if jsonb_typeof(p->'hourly'->k) is distinct from 'array' or jsonb_array_length(p->'hourly'->k) is distinct from n then return false; end if;
  end loop;
  n := jsonb_array_length(p->'daily'->'time');
  if n is null or n < 1 or n > 16 then return false; end if;
  foreach k in array array['weather_code', 'temperature_2m_max', 'temperature_2m_min',
                           'precipitation_probability_max', 'precipitation_sum'] loop
    if jsonb_typeof(p->'daily'->k) is distinct from 'array' or jsonb_array_length(p->'daily'->k) is distinct from n then return false; end if;
  end loop;
  return coalesce(p->'hourly_units'->>'temperature_2m', '') = '°C'
     and coalesce(p->'hourly_units'->>'wind_speed_10m', '') = 'km/h'
     and coalesce(p->'hourly_units'->>'precipitation', '') = 'mm';
end $$;
revoke all on function private.weather_payload_ok(jsonb, text) from public, anon, authenticated;

-- ---------- 6. Worker RPCs (Edge Function, shared outbox secret) ----------
-- Claims this hour's fetch for each venue coordinate with an eligible game. One attempt per
-- coordinate per hour; a claim abandoned for 10 minutes may be retried once in the same hour.
-- Concurrent invocations cannot both claim: the unique (coord_key, slot_hour) row decides.
create or replace function public.claim_weather_fetches(p_secret text, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_slot timestamptz := date_trunc('hour', now()); v_out jsonb;
begin
  if not private.outbox_secret_ok(p_secret) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from private.weather_fetches where slot_hour < now() - interval '3 days';
  with due as (
    select distinct private.weather_coord_key(e.latitude, e.longitude, e.timezone) as coord_key,
           round(e.latitude, 3) as latitude, round(e.longitude, 3) as longitude, e.timezone
    from private.weather_eligible(now()) e
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  ), ins as (
    insert into private.weather_fetches (coord_key, latitude, longitude, timezone, slot_hour)
    select d.coord_key, d.latitude, d.longitude, d.timezone, v_slot from due d
    on conflict (coord_key, slot_hour) do nothing
    returning id, latitude, longitude, timezone
  ), rec as (
    update private.weather_fetches f set attempts = f.attempts + 1, claimed_at = now()
    where f.slot_hour = v_slot and f.status = 'claimed' and f.attempts < 2
      and f.claimed_at < now() - interval '10 minutes'
    returning f.id, f.latitude, f.longitude, f.timezone
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'latitude', x.latitude, 'longitude', x.longitude,
                                               'timezone', x.timezone) order by x.id), '[]'::jsonb)
    into v_out from (select * from ins union all select * from rec) x;
  return v_out;
end $$;

create or replace function public.complete_weather_fetch(p_secret text, p_id bigint, p_payload jsonb, p_error text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_row private.weather_fetches;
begin
  if not private.outbox_secret_ok(p_secret) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_row from private.weather_fetches where id = p_id and status = 'claimed' for update;
  if not found then return false; end if;
  if p_error is null and private.weather_payload_ok(p_payload, v_row.timezone) then
    update private.weather_fetches set status = 'succeeded', payload = p_payload - 'generationtime_ms',
           completed_at = now(), error = null where id = p_id;
  else
    -- A failed or invalid response never replaces an earlier successful forecast.
    update private.weather_fetches set status = 'failed', completed_at = now(),
           error = left(coalesce(p_error, 'invalid_payload'), 300) where id = p_id;
  end if;
  return true;
end $$;
revoke all on function public.claim_weather_fetches(text, int), public.complete_weather_fetch(text, bigint, jsonb, text)
  from public, authenticated;
grant execute on function public.claim_weather_fetches(text, int), public.complete_weather_fetch(text, bigint, jsonb, text)
  to anon, service_role;

create or replace function private.kick_weather_fetch()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  -- Nothing to do: avoid waking the Edge Function at all.
  if not exists (select 1 from private.weather_eligible(now())) then return; end if;
  select replace(decrypted_secret, 'send-promotions', 'weather-fetch') into v_url
    from vault.decrypted_secrets where name = 'pickleme_send_promotions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'pickleme_outbox_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := v_url, body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-outbox-secret', v_secret),
    timeout_milliseconds := 60000);
end $$;
revoke all on function private.kick_weather_fetch() from public, anon, authenticated;

-- ---------- 7. Member read: the cached forecast for one game ----------
-- Returns only the hours a game page needs: the whole game date plus the game window (for overnight
-- games), with one extra hour so the last hour's rain chance (a preceding-hour value) is included.
create or replace function public.get_game_weather(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid(); -- raises when signed out
  g public.games; gr public.groups; v public.weather_venues; w record;
  f private.weather_fetches; v_last timestamptz; v_last_failed boolean; v_hours jsonb; v_day jsonb;
  v_from timestamptz; v_to timestamptz; v_manage boolean;
begin
  select * into g from public.games where id = p_game_id;
  if not found then raise exception 'game_not_found' using errcode = 'P0002'; end if;
  if not private.is_member(g.group_id) then raise exception 'not_member' using errcode = '42501'; end if;
  select * into gr from public.groups where id = g.group_id;
  v_manage := private.has_role(g.group_id, array['organiser', 'admin']::public.member_role[]);
  select * into w from private.weather_window(g.starts_at, g.ends_at, gr.timezone);

  select * into v from public.weather_venues
    where group_id = g.group_id and location_key = private.location_key(g.location);
  if not found then
    return jsonb_build_object('state', case when private.location_key(g.location) is null then 'no_location'
                                            else 'not_configured' end,
      'can_manage', v_manage, 'location', g.location, 'now', now());
  end if;

  select * into f from private.weather_fetches
    where coord_key = private.weather_coord_key(v.latitude, v.longitude, gr.timezone) and status = 'succeeded'
    order by slot_hour desc limit 1;
  -- Latest attempt (any outcome), so the card can say an update was tried and failed.
  select x.claimed_at, x.status = 'failed' into v_last, v_last_failed from private.weather_fetches x
    where x.coord_key = private.weather_coord_key(v.latitude, v.longitude, gr.timezone)
    order by x.slot_hour desc limit 1;

  v_from := (w.game_date::timestamp at time zone gr.timezone);
  v_to := greatest(((w.game_date + 1)::timestamp at time zone gr.timezone), g.ends_at + interval '2 hours');

  if f.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
        't', ts,
        'temp', f.payload->'hourly'->'temperature_2m'->(i - 1)::int,
        'code', f.payload->'hourly'->'weather_code'->(i - 1)::int,
        'pop', f.payload->'hourly'->'precipitation_probability'->(i - 1)::int,
        'rain', f.payload->'hourly'->'precipitation'->(i - 1)::int,
        'wind', f.payload->'hourly'->'wind_speed_10m'->(i - 1)::int,
        'day', f.payload->'hourly'->'is_day'->(i - 1)::int) order by i), '[]'::jsonb)
      into v_hours
      from (select e.i, ((e.t #>> '{}')::timestamp at time zone gr.timezone) as ts
            from jsonb_array_elements(f.payload->'hourly'->'time') with ordinality e(t, i)) h
      where ts >= v_from and ts <= v_to;
    select jsonb_build_object('date', d.t #>> '{}',
        'code', f.payload->'daily'->'weather_code'->(d.i - 1)::int,
        'tmax', f.payload->'daily'->'temperature_2m_max'->(d.i - 1)::int,
        'tmin', f.payload->'daily'->'temperature_2m_min'->(d.i - 1)::int,
        'pop_max', f.payload->'daily'->'precipitation_probability_max'->(d.i - 1)::int,
        'rain_sum', f.payload->'daily'->'precipitation_sum'->(d.i - 1)::int)
      into v_day
      from jsonb_array_elements(f.payload->'daily'->'time') with ordinality d(t, i)
      where (d.t #>> '{}') = w.game_date::text;
  end if;

  return jsonb_build_object(
    'state', case when g.status = 'cancelled' then 'cancelled' else 'configured' end,
    'can_manage', v_manage, 'now', now(), 'timezone', gr.timezone,
    'location', g.location,
    'venue', jsonb_build_object('address', v.address, 'latitude', v.latitude, 'longitude', v.longitude),
    'game', jsonb_build_object('starts_at', g.starts_at, 'ends_at', g.ends_at, 'date', w.game_date, 'day_start', v_from),
    'active_from', w.active_from, 'active_until', w.active_until,
    'last_attempt_at', v_last, 'last_attempt_failed', coalesce(v_last_failed, false),
    'forecast', case when f.id is null then null else jsonb_build_object(
      'provider', 'Open-Meteo', 'fetched_at', f.completed_at,
      'grid', jsonb_build_object('latitude', f.payload->'latitude', 'longitude', f.payload->'longitude'),
      'hours', v_hours, 'day', v_day) end);
end $$;
revoke all on function public.get_game_weather(uuid) from public, anon;
grant execute on function public.get_game_weather(uuid) to authenticated;

-- ---------- 8. Organiser/admin: confirm or remove the venue for a game's location ----------
create or replace function public.save_weather_venue(p_game_id uuid, p_address text, p_latitude numeric, p_longitude numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); g public.games; v_key text; v_prev public.weather_venues; v_id uuid;
begin
  select * into g from public.games where id = p_game_id;
  if not found then raise exception 'game_not_found' using errcode = 'P0002'; end if;
  if not private.has_role(g.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_key := private.location_key(g.location);
  if v_key is null then raise exception 'weather_location_required' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_address, ''))) not between 1 and 200
     or p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'invalid_weather_venue' using errcode = '22023';
  end if;
  select * into v_prev from public.weather_venues where group_id = g.group_id and location_key = v_key;
  insert into public.weather_venues (group_id, location_key, location_text, address, latitude, longitude, confirmed_by)
  values (g.group_id, v_key, btrim(g.location), btrim(p_address), round(p_latitude, 6), round(p_longitude, 6), v_uid)
  on conflict (group_id, location_key) do update
    set location_text = excluded.location_text, address = excluded.address, latitude = excluded.latitude,
        longitude = excluded.longitude, confirmed_by = excluded.confirmed_by, confirmed_at = now()
  returning id into v_id;
  perform private.audit(g.group_id, g.id, 'weather_venue_set', null, jsonb_build_object(
    'location', btrim(g.location), 'address', btrim(p_address),
    'latitude', round(p_latitude, 6), 'longitude', round(p_longitude, 6),
    'previous_address', v_prev.address));
  return jsonb_build_object('id', v_id, 'address', btrim(p_address));
end $$;

create or replace function public.remove_weather_venue(p_game_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); g public.games; v_prev public.weather_venues;
begin
  select * into g from public.games where id = p_game_id;
  if not found then raise exception 'game_not_found' using errcode = 'P0002'; end if;
  if not private.has_role(g.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.weather_venues where group_id = g.group_id and location_key = private.location_key(g.location)
    returning * into v_prev;
  if v_prev.id is null then return false; end if;
  perform private.audit(g.group_id, g.id, 'weather_venue_removed', null,
    jsonb_build_object('location', v_prev.location_text, 'address', v_prev.address));
  return true;
end $$;
revoke all on function public.save_weather_venue(uuid, text, numeric, numeric), public.remove_weather_venue(uuid) from public, anon;
grant execute on function public.save_weather_venue(uuid, text, numeric, numeric), public.remove_weather_venue(uuid) to authenticated;
