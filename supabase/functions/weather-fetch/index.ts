// FR-017: hourly forecast fetch for venues with a game in its weather window.
// Called by pg_cron through private.kick_weather_fetch with the shared `x-outbox-secret` header.
// Deployed with verify_jwt = false; the secret is checked by the database in claim/complete.
// Only coordinates and the timezone are sent to Open-Meteo — never member, group or game details.
// One attempt per venue per hour: failures are recorded and the next hourly run tries again.
import { createClient } from 'npm:@supabase/supabase-js@2'

const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PROVIDER = 'https://api.open-meteo.com/v1/forecast'
const HOURLY = 'temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,is_day'
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Claim = { id: number; latitude: number; longitude: number; timezone: string }

export function forecastUrl(c: Claim) {
  const q = new URLSearchParams({
    latitude: String(c.latitude), longitude: String(c.longitude), timezone: c.timezone,
    hourly: HOURLY, daily: DAILY, forecast_days: '3',
    temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm',
  })
  return `${PROVIDER}?${q}`
}

// Light shape check; the database validates fully before storing.
function looksValid(p: Record<string, unknown>, tz: string) {
  const h = p.hourly as Record<string, unknown[]> | undefined
  const d = p.daily as Record<string, unknown[]> | undefined
  return !!h && !!d && p.timezone === tz && Array.isArray(h.time) && h.time.length >= 24 &&
    HOURLY.split(',').every(k => Array.isArray(h[k]) && h[k].length === h.time.length) &&
    Array.isArray(d.time) && DAILY.split(',').every(k => Array.isArray(d[k]) && d[k].length === d.time.length)
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'invalid_request' })
  const secret = req.headers.get('x-outbox-secret') ?? ''
  if (!secret) return json(401, { error: 'forbidden' })
  const db = createClient(URL, SERVICE, { auth: { persistSession: false } })

  const { data, error } = await db.rpc('claim_weather_fetches', { p_secret: secret, p_limit: 20 })
  if (error) return json(error.code === '42501' ? 401 : 500, { error: error.code === '42501' ? 'forbidden' : 'claim_failed' })
  const claims = (data ?? []) as Claim[]

  let ok = 0, failed = 0
  for (const c of claims) {
    let payload: Record<string, unknown> | null = null
    let err: string | null = null
    try {
      const res = await fetch(forecastUrl(c), { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } })
      if (!res.ok) err = `http_${res.status}`
      else {
        payload = await res.json()
        if (!payload || !looksValid(payload, c.timezone)) { err = 'invalid_payload'; payload = null }
      }
    } catch (e) {
      err = e instanceof DOMException && e.name === 'TimeoutError' ? 'timeout' : 'network_error'
    }
    const { error: cErr } = await db.rpc('complete_weather_fetch',
      { p_secret: secret, p_id: c.id, p_payload: payload, p_error: err })
    if (cErr || err) failed++; else ok++
  }
  console.log(JSON.stringify({ event: 'weather_fetch', claimed: claims.length, ok, failed }))
  return json(200, { claimed: claims.length, ok, failed })
})
