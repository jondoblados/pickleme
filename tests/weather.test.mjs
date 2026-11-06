import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWeatherView, hourIntervals, gameWindow, conditionFor, severity, STALE_AFTER_MS } from '../src/lib/weather-core.js'

const H = 3600000
// Singapore is UTC+8 with no DST. Game date 2026-11-10 starts at 2026-11-09T16:00Z.
const DAY_START = Date.parse('2026-11-09T16:00:00Z')
const iso = ms => new Date(ms).toISOString()
const sgt = (hh, mm = 0, dayOffset = 0) => iso(DAY_START + dayOffset * 24 * H + hh * H + mm * 60000)

// Hourly points for the game date 00:00 .. next day 03:00 (inclusive). pop = local hour stamp * 2.
function hours(count = 28) {
  return Array.from({ length: count }, (_, i) => ({
    t: iso(DAY_START + i * H), temp: 25 + (i % 24) / 4, code: i % 24 === 20 ? 95 : 3, pop: i * 2, rain: i / 10, wind: 8, day: i % 24 >= 7 && i % 24 < 19 ? 1 : 0,
  }))
}
function resp({ now, start = sgt(19), end = sgt(21), hrs = hours(), fetched = null, failed = false, state = 'configured', forecast = true } = {}) {
  const dayStart = iso(DAY_START)
  return {
    state, can_manage: false, now, timezone: 'Asia/Singapore', location: 'CBP1 L6 Multi-purpose Courts',
    venue: { address: '1 Changi Business Park Crescent', latitude: 1.333, longitude: 103.966 },
    game: { starts_at: start, ends_at: end, date: '2026-11-10', day_start: dayStart },
    active_from: iso(DAY_START - 24 * H),
    active_until: iso(Math.max(DAY_START + 24 * H, Date.parse(end) + H)),
    last_attempt_at: fetched ?? now, last_attempt_failed: failed,
    forecast: forecast ? { provider: 'Open-Meteo', fetched_at: fetched ?? now, grid: { latitude: 1.37, longitude: 103.94 },
      hours: hrs, day: { date: '2026-11-10', code: 95, tmax: 31, tmin: 24, pop_max: 80, rain_sum: 6.1 } } : null,
  }
}

test('rain chance for an hour comes from the following timestamp (preceding-hour semantics)', () => {
  const iv = hourIntervals(hours(3))
  assert.equal(iv.length, 2)
  assert.equal(iv[0].start, DAY_START); assert.equal(iv[0].pop, 2); assert.equal(iv[0].rain, 0.1)
  assert.equal(iv[0].temp, 25); assert.equal(iv[0].code, 3)
})

test('gaps in hourly data do not produce fake intervals', () => {
  const h = hours(5); h.splice(2, 1)
  assert.equal(hourIntervals(h).length, 2)
})

test('game window is one hour before start to one hour after end', () => {
  const w = gameWindow(sgt(19), sgt(21))
  assert.equal(w.from, DAY_START + 18 * H); assert.equal(w.to, DAY_START + 22 * H)
})

test('before the window opens: not yet; after it closes: hidden', () => {
  assert.equal(buildWeatherView(resp({ now: iso(DAY_START - 24 * H - 1000) })).kind, 'not_yet')
  assert.equal(buildWeatherView(resp({ now: iso(DAY_START + 24 * H) })).kind, 'hidden')
})

test('day before shows the whole game date in four parts with the game marked', () => {
  const v = buildWeatherView(resp({ now: iso(DAY_START - 5 * H) }))
  assert.equal(v.kind, 'day_before')
  assert.equal(v.complete, true)
  assert.deepEqual(v.parts.map(p => p.label), ['Night', 'Morning', 'Afternoon', 'Evening'])
  assert.deepEqual(v.parts.map(p => p.hasGame), [false, false, false, true])
  const evening = v.parts[3]
  assert.equal(evening.code, 95); assert.equal(evening.thunder, true)
  assert.equal(evening.popMax, 48) // 23:00–24:00 uses the 24:00 stamp (index 24 * 2)
  assert.equal(v.daily.popMax, 80)
  assert.equal(v.game.thunder, true) // 20:00 thundery
})

test('game day: whole-hour game lists 18:00–22:00 as four hourly intervals, two in game', () => {
  const v = buildWeatherView(resp({ now: sgt(8) }))
  assert.equal(v.kind, 'game_day')
  assert.deepEqual(v.slots.map(s => (s.start - DAY_START) / H), [18, 19, 20, 21])
  assert.deepEqual(v.slots.map(s => s.inGame), [false, true, true, false])
  assert.equal(v.complete, true)
  assert.equal(v.game.popMax, 42) // 20:00–21:00 -> stamp 21:00 -> 42
})

test('half-hour game includes every overlapping hour without rounding the game', () => {
  const v = buildWeatherView(resp({ now: sgt(8), start: sgt(19, 30), end: sgt(21, 30) }))
  assert.deepEqual(v.slots.map(s => (s.start - DAY_START) / H), [18, 19, 20, 21, 22])
  assert.deepEqual(v.slots.map(s => s.inGame), [false, true, true, true, false])
  assert.equal(v.window.from, DAY_START + 18.5 * H)
})

test('overnight game window crosses midnight', () => {
  const v = buildWeatherView(resp({ now: sgt(20), start: sgt(23), end: sgt(1, 0, 1) }))
  assert.equal(v.kind, 'game_day')
  assert.deepEqual(v.slots.map(s => (s.start - DAY_START) / H), [22, 23, 24, 25])
  assert.equal(v.complete, true)
})

test('missing hours are reported as partial, not padded', () => {
  const v = buildWeatherView(resp({ now: sgt(8), hrs: hours(21) }))
  assert.equal(v.complete, false)
  assert.deepEqual(v.slots.map(s => (s.start - DAY_START) / H), [18, 19])
})

test('stale after two hours without a successful update', () => {
  const now = sgt(8)
  assert.equal(buildWeatherView(resp({ now, fetched: iso(Date.parse(now) - STALE_AFTER_MS) })).stale, false)
  assert.equal(buildWeatherView(resp({ now, fetched: iso(Date.parse(now) - STALE_AFTER_MS - 1000) })).stale, true)
})

test('pending vs unavailable when no forecast has ever succeeded', () => {
  assert.equal(buildWeatherView(resp({ now: sgt(8), forecast: false })).kind, 'pending')
  assert.equal(buildWeatherView(resp({ now: sgt(8), forecast: false, failed: true })).kind, 'unavailable')
})

test('unconfigured: organisers get setup, players see nothing; cancelled is hidden', () => {
  assert.equal(buildWeatherView({ state: 'not_configured', can_manage: true, now: sgt(8), location: 'X' }).kind, 'setup')
  assert.equal(buildWeatherView({ state: 'not_configured', can_manage: false, now: sgt(8) }).kind, 'hidden')
  assert.equal(buildWeatherView({ state: 'cancelled', can_manage: true, now: sgt(8) }).kind, 'hidden')
  assert.equal(buildWeatherView({ state: 'no_location', can_manage: true, now: sgt(8) }).kind, 'hidden')
})

test('conditions map to icons with night variants and severity ordering', () => {
  assert.equal(conditionFor(0, 0).key, 'clear-night'); assert.equal(conditionFor(2, 1).key, 'partly')
  assert.equal(conditionFor(95).label, 'Thundery showers'); assert.equal(conditionFor(81).key, 'showers')
  assert.ok(severity(95) > severity(82) && severity(82) > severity(80) && severity(80) > severity(3) && severity(3) > severity(0))
})
