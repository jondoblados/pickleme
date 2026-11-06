// FR-017 pure forecast logic (no DOM, no network) so it can be unit-tested with node --test.
//
// Open-Meteo semantics: temperature, wind and weather_code are instantaneous at the timestamp;
// precipitation_probability and precipitation describe the PRECEDING hour. An hour column that
// starts at 19:00 therefore uses the 19:00 conditions and the rain values stamped 20:00.

const HOUR = 3600000
export const STALE_AFTER_MS = 2 * HOUR

/** WMO weather code -> icon key + plain-English label. */
export function conditionFor(code, isDay = 1) {
  const day = isDay !== 0
  if (code === 0) return { key: day ? 'clear' : 'clear-night', label: day ? 'Sunny' : 'Clear' }
  if (code === 1 || code === 2) return { key: day ? 'partly' : 'partly-night', label: 'Partly cloudy' }
  if (code === 3) return { key: 'cloudy', label: 'Cloudy' }
  if (code === 45 || code === 48) return { key: 'fog', label: 'Hazy or foggy' }
  if (code >= 51 && code <= 57) return { key: 'drizzle', label: 'Drizzle' }
  if (code === 61 || code === 66) return { key: 'rain', label: 'Light rain' }
  if (code === 63) return { key: 'rain', label: 'Rain' }
  if (code === 65 || code === 67) return { key: 'rain', label: 'Heavy rain' }
  if (code === 80) return { key: 'showers', label: 'Light showers' }
  if (code === 81) return { key: 'showers', label: 'Showers' }
  if (code === 82) return { key: 'showers', label: 'Heavy showers' }
  if (code >= 95 && code <= 99) return { key: 'thunder', label: 'Thundery showers' }
  if (code >= 71 && code <= 86) return { key: 'rain', label: 'Wintry showers' }
  return { key: 'cloudy', label: 'Unsettled' }
}

/** How significant a condition is for players; used to pick the headline for a block of hours. */
export function severity(code) {
  if (code == null) return -1
  if (code >= 95) return 7
  if (code === 65 || code === 67 || code === 82) return 6
  if ((code >= 61 && code <= 66) || code === 80 || code === 81) return 5
  if (code >= 51 && code <= 57) return 4
  if (code === 45 || code === 48) return 3
  if (code === 3) return 2
  if (code === 1 || code === 2) return 1
  if (code === 0) return 0
  return 2
}

/** Turn hourly points into one-hour intervals, pairing preceding-hour rain values correctly. */
export function hourIntervals(hours) {
  const pts = (hours ?? []).map(h => ({ ...h, ms: Date.parse(h.t) })).filter(h => Number.isFinite(h.ms))
    .sort((a, b) => a.ms - b.ms)
  const out = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1]
    if (b.ms - a.ms !== HOUR) continue
    out.push({ start: a.ms, end: b.ms, temp: num(a.temp), code: num(a.code), day: a.day === 0 ? 0 : 1,
      wind: num(a.wind), pop: num(b.pop), rain: num(b.rain) })
  }
  return out
}
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null }

/** Exact game-day window: one hour before the start until one hour after the end. */
export function gameWindow(startsAt, endsAt) {
  return { from: Date.parse(startsAt) - HOUR, to: Date.parse(endsAt) + HOUR }
}

function summarise(list) {
  const temps = list.map(i => i.temp).filter(t => t != null)
  const pops = list.map(i => i.pop).filter(p => p != null)
  const worst = list.reduce((w, i) => (severity(i.code) > severity(w?.code) ? i : w), null)
  return {
    code: worst?.code ?? null, day: worst?.day ?? 1,
    tmin: temps.length ? Math.min(...temps) : null, tmax: temps.length ? Math.max(...temps) : null,
    popMax: pops.length ? Math.max(...pops) : null,
    thunder: list.some(i => i.code != null && i.code >= 95),
  }
}

/**
 * Decide what the weather card shows, using the server's clock (`resp.now`).
 * kinds: hidden | setup | not_yet | pending | unavailable | day_before | game_day
 */
export function buildWeatherView(resp) {
  if (!resp) return { kind: 'hidden' }
  if (resp.state === 'not_configured') return resp.can_manage ? { kind: 'setup', location: resp.location } : { kind: 'hidden' }
  if (resp.state !== 'configured') return { kind: 'hidden' } // no_location, cancelled
  const now = Date.parse(resp.now)
  const base = { venue: resp.venue, location: resp.location, canManage: !!resp.can_manage, timezone: resp.timezone }
  if (now >= Date.parse(resp.active_until)) return { kind: 'hidden' }
  if (now < Date.parse(resp.active_from)) return { kind: 'not_yet', ...base, availableFrom: resp.active_from }
  const f = resp.forecast
  if (!f) return { kind: resp.last_attempt_failed ? 'unavailable' : 'pending', ...base }

  const fetchedAt = f.fetched_at
  const stale = now - Date.parse(fetchedAt) > STALE_AFTER_MS
  const meta = { ...base, fetchedAt, stale, provider: f.provider, grid: f.grid,
    lastAttemptFailed: !!resp.last_attempt_failed }
  const all = hourIntervals(f.hours)
  const dayStart = Date.parse(resp.game.day_start)
  const dayEnd = dayStart + 24 * HOUR
  const gameStart = Date.parse(resp.game.starts_at), gameEnd = Date.parse(resp.game.ends_at)

  if (now < dayStart) {
    const dayHours = all.filter(i => i.start >= dayStart && i.end <= dayEnd)
    const parts = [['Night', 0, 6], ['Morning', 6, 12], ['Afternoon', 12, 18], ['Evening', 18, 24]].map(([label, a, b]) => {
      const from = dayStart + a * HOUR, to = dayStart + b * HOUR
      const list = dayHours.filter(i => i.start >= from && i.end <= to)
      return { label, from, to, hasGame: gameStart < to && gameEnd > from, complete: list.length === b - a, ...summarise(list) }
    })
    const d = f.day
    return { kind: 'day_before', ...meta, date: resp.game.date, complete: dayHours.length === 24,
      daily: d ? { code: num(d.code), tmin: num(d.tmin), tmax: num(d.tmax), popMax: num(d.pop_max), rainSum: num(d.rain_sum) } : null,
      parts, game: summarise(dayHours.filter(i => i.start < gameEnd && i.end > gameStart)) }
  }

  const w = gameWindow(resp.game.starts_at, resp.game.ends_at)
  const firstStart = Math.floor(w.from / HOUR) * HOUR
  const lastEnd = Math.ceil(w.to / HOUR) * HOUR
  const expected = Math.round((lastEnd - firstStart) / HOUR)
  const slots = all.filter(i => i.start < w.to && i.end > w.from)
    .map(i => ({ ...i, inGame: i.start < gameEnd && i.end > gameStart, isNow: now >= i.start && now < i.end }))
  return { kind: 'game_day', ...meta, window: w, slots, complete: slots.length === expected,
    game: summarise(slots.filter(s => s.inGame)), gameStart, gameEnd }
}
