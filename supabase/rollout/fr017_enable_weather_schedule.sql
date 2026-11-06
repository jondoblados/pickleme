-- FR-017 rollout step: start the hourly weather fetch. Run ONLY after the migration is applied,
-- the `weather-fetch` Edge Function is deployed (verify_jwt = false), and a manual run has been checked:
--   select private.kick_weather_fetch();   -- then inspect private.weather_fetches
-- Runs at minute 2 of every hour. The kick returns immediately (no HTTP call) when no game is in its window.
select cron.schedule('pickleme-weather-fetch', '2 * * * *', 'select private.kick_weather_fetch()');

-- Rollback (disables fetching; game pages keep working and show the last forecast as out of date,
-- or remove venues to hide the card entirely):
--   select cron.unschedule('pickleme-weather-fetch');
