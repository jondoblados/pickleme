# FR-017 — Game weather: design and rollout

Status: implemented on branch `feature/fr017-game-weather`, in review. Nothing has been applied to production.

## Decisions (2026-11-07)

- Day-before overview: forecast for the complete game date (00:00–24:00, Asia/Singapore).
- Game-day window: one hour before the start until one hour after the end.
- Venue: the address used for the game. A game's `location` text is mapped once per group to a confirmed address and coordinates.

## Data flow

1. An organiser or admin opens a game and taps **Set up weather**. The browser searches OneMap (or accepts typed coordinates) and
   calls `save_weather_venue(game, address, lat, lon)`, which stores a row in `public.weather_venues` keyed by group and normalised
   location text (`private.location_key`). Audit events: `weather_venue_set`, `weather_venue_removed`.
2. pg_cron runs `private.kick_weather_fetch()` at minute 2 of every hour. It exits without a network call unless a game is eligible
   (`private.weather_eligible`): not cancelled, has a configured venue, and now is between 00:00 the day before and the later of
   24:00 on the game date or end + 1 h. Otherwise it posts to the `weather-fetch` Edge Function (URL derived from the Vault secret
   `pickleme_send_promotions_url`, authenticated with the shared outbox secret).
3. `weather-fetch` calls `claim_weather_fetches`, which hands out one claim per coordinate key (3 decimals + timezone) per hourly slot,
   retries an abandoned claim once after 10 minutes, and deletes cache rows older than 3 days. For each claim it calls Open-Meteo
   (hourly: temperature_2m, weather_code, precipitation_probability, precipitation, wind_speed_10m, is_day; daily: weather_code,
   temperature max/min, precipitation_probability_max, precipitation_sum; `forecast_days=3`; 15 s timeout) and stores the result via
   `complete_weather_fetch`. A failure never overwrites an earlier success.
4. Members read `get_game_weather(game)`, which returns a state (`no_location`, `not_configured`, `configured`, `cancelled`) and, when
   configured, the day summary plus hours from 00:00 on the game date to the later of 24:00 or end + 2 h, with `fetched_at` and
   `last_attempt_failed`.
5. `src/lib/weather-core.js` (`buildWeatherView`) turns this into a view: hidden, setup, not_yet, pending, unavailable, day_before or
   game_day. Data older than 2 hours is marked stale. Hour columns are intervals: rain chance and amount come from the next
   timestamp because Open-Meteo reports them for the preceding hour.

The card sits after **Your status** and before the roster lists so the Join button stays prominent. It is hidden on RPC errors.

## Rollout (each step needs approval)

1. Apply `supabase/migrations/20261107000016_game_weather.sql` to project `bzxkbulljurizjrpixdm`.
2. Deploy the `weather-fetch` Edge Function with `verify_jwt = false` (it checks the shared secret itself).
3. Set up a venue on one game, then run `select private.kick_weather_fetch();` and inspect `private.weather_fetches`.
4. Run `supabase/rollout/fr017_enable_weather_schedule.sql` (schedules `pickleme-weather-fetch`, `2 * * * *`).
5. Merge to `main`; GitHub Pages deploys the frontend.

Rollback: `select cron.unschedule('pickleme-weather-fetch');`. The card then shows the last forecast or "unavailable"; removing
venues hides it.

## Open questions

- Open-Meteo's free API is for non-commercial use and requires CC BY 4.0 attribution (shown as a link on the card).
- OneMap search currently returns "Authentication token missing" as a warning but still answers. If a token becomes mandatory,
  organisers can enter coordinates instead.
- Open-Meteo's grid point is about 4 km from Changi Business Park, so the card says "Forecast area near …".
- "CBP1 L6 Multi-purpose Courts" does not match in OneMap; search "Changi Business Park" or the building address and confirm it.
- Version bump (0.11.0) to be made at release.

## Rollout log

- 2026-11-07: Step 1 done — migration `game_weather` applied to production.
- 2026-11-07: Step 2 done — `weather-fetch` deployed (version 1, `verify_jwt = false`).
- 2026-11-07: Step 3 partly done. There were no upcoming games or venues, so `kick_weather_fetch()` correctly exited early.
  A direct call with the shared secret returned 200 `{"claimed":0,"ok":0,"failed":0}`; a wrong secret returned 401. No forecast has
  been fetched in production yet — that needs a configured venue and a game within the window.
