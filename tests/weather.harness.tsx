// FR-017 review harness: renders every weather-card state from fictional fixtures (no network).
// npm run dev, then open /pickleme/tests/weather.harness.html
import { createRoot } from 'react-dom/client'
import '../src/styles.css'
import { VenueSetup, WeatherPanel } from '../src/components/WeatherCard'
import { ToastProvider } from '../src/components/ui'
import { buildWeatherView, type WeatherResponse } from '../src/lib/weather-core.js'

const H = 3600000
const DAY = Date.parse('2026-11-09T16:00:00Z') // 00:00 SGT, Tue 10 Nov 2026
const iso = (ms: number) => new Date(ms).toISOString()
// Fictional Singapore-like evening: showers late afternoon, a thundery spell around 7–8 pm.
const code = (h: number) => [3, 3, 3, 3, 3, 2, 2, 1, 1, 2, 2, 3, 3, 80, 80, 81, 95, 95, 81, 95, 80, 3, 3, 2][h % 24]
const pop = (h: number) => [20, 20, 15, 10, 10, 10, 10, 10, 15, 20, 25, 35, 45, 60, 70, 75, 80, 75, 70, 65, 55, 40, 30, 25][h % 24]
const hours = Array.from({ length: 30 }, (_, i) => ({
  t: iso(DAY + i * H), temp: [25, 25, 24.6, 24.4, 24.3, 24.3, 24.5, 25.6, 27, 28.4, 29.5, 30.3, 30.8, 30.6, 29.8, 28.6, 27.5, 27, 26.6, 26.2, 26, 25.8, 25.5, 25.3][i % 24],
  code: code(i), pop: pop(i), rain: pop(i) > 50 ? 0.8 : 0.1, wind: 9 + (i % 5), day: i % 24 >= 7 && i % 24 < 19 ? 1 : 0,
}))
const base = (now: number, over: Partial<WeatherResponse> = {}): WeatherResponse => ({
  state: 'configured', can_manage: true, now: iso(now), timezone: 'Asia/Singapore', location: 'CBP1 L6 Multi-purpose Courts',
  venue: { address: '1 Changi Business Park Crescent, Singapore 486025', latitude: 1.333351, longitude: 103.965669 },
  game: { starts_at: iso(DAY + 19 * H), ends_at: iso(DAY + 21 * H), date: '2026-11-10', day_start: iso(DAY) },
  active_from: iso(DAY - 24 * H), active_until: iso(DAY + 24 * H), last_attempt_at: iso(now - 5 * 60000), last_attempt_failed: false,
  forecast: { provider: 'Open-Meteo', fetched_at: iso(now - 20 * 60000), grid: { latitude: 1.37, longitude: 103.94 }, hours,
    day: { date: '2026-11-10', code: 95, tmax: 30.8, tmin: 24.3, pop_max: 80, rain_sum: 9.6 } },
  ...over,
})
const states: [string, WeatherResponse][] = [
  ['Day before (Mon 9 Nov, 6:20 pm) — complete game date', base(DAY - 5.7 * H)],
  ['Game day (Tue 10 Nov, 6:40 pm) — 6 pm to 10 pm, game 7–9 pm', base(DAY + 18.67 * H)],
  ['Game day, half-hour game 7:30–9:30 pm, forecast out of date', base(DAY + 15 * H, {
    game: { starts_at: iso(DAY + 19.5 * H), ends_at: iso(DAY + 21.5 * H), date: '2026-11-10', day_start: iso(DAY) },
    forecast: { ...base(0).forecast!, fetched_at: iso(DAY + 12 * H) }, last_attempt_failed: true })],
  ['Two days before', base(DAY - 30 * H)],
  ['Window open, first update pending', base(DAY - 2 * H, { forecast: null, last_attempt_at: null })],
  ['Window open, provider failed, nothing cached', base(DAY - 2 * H, { forecast: null, last_attempt_failed: true })],
]

function App() {
  return <ToastProvider><main className="page stack-lg">
    <h1 className="display">FR-017 weather card — review states</h1>
    <p className="small muted">Fictional fixture data, not a live forecast. Organiser view (shows “Change venue”).</p>
    {states.map(([title, r]) => {
      const v = buildWeatherView(r)
      return <div key={title} className="stack"><h2>{title}</h2>
        {v.kind === 'hidden' || v.kind === 'setup' ? <p>{v.kind}</p> : <WeatherPanel view={v} onEdit={() => {}} />}</div>
    })}
    <div className="stack"><h2>Organiser, venue not set up (players see nothing)</h2>
      <VenueSetup gameId="fixture" location="CBP1 L6 Multi-purpose Courts" current={null} onDone={() => {}} /></div>
    <div className="stack"><h2>Organiser, setting up the venue</h2>
      <VenueSetup gameId="fixture" location="CBP1 L6 Multi-purpose Courts" current="1 Changi Business Park Crescent, Singapore 486025" onDone={() => {}} onCancel={() => {}} /></div>
  </main></ToastProvider>
}
createRoot(document.getElementById('root')!).render(<App />)
