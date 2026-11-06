// FR-017: forecast card on the game page. Reads the server-side cache only (get_game_weather);
// opening a game never calls the weather provider. Any read error hides the card, so sign-ups,
// withdrawals and the roster never depend on weather.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fmtDay, fmtShortDay, fmtTime } from '../lib/time'
import { buildWeatherView, conditionFor, type Summary, type WeatherResponse, type WeatherView } from '../lib/weather-core.js'
import { WeatherIcon } from './WeatherIcon'
import { ConfirmButton, useToast } from './ui'

const hourLabel = (ms: number, tz: string) => fmtTime(new Date(ms).toISOString(), tz).replace(':00', '')
const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v)}%`)
const deg = (v: number | null) => (v == null ? '–' : `${Math.round(v)}°`)
const range = (a: number | null, b: number | null) => (a == null || b == null ? '–' : Math.round(a) === Math.round(b) ? `${Math.round(a)}°C` : `${Math.round(a)}–${Math.round(b)}°C`)

export function WeatherCard({ gameId, refreshKey }: { gameId: string; refreshKey: string }) {
  const [resp, setResp] = useState<WeatherResponse | null>(null)
  const [editing, setEditing] = useState(false)
  const load = useCallback(async () => {
    try { setResp(await api.getWeather(gameId)) } catch { setResp(null) }
  }, [gameId])

  useEffect(() => { load() }, [load, refreshKey])
  // The cache updates hourly; re-read every 10 minutes while the page is visible.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, 600000)
    return () => window.clearInterval(t)
  }, [load])

  const view = buildWeatherView(resp)
  if (view.kind === 'hidden') return null
  if (view.kind === 'setup' || editing) {
    return <VenueSetup gameId={gameId} location={resp?.location ?? ''} current={view.kind === 'setup' ? null : resp?.venue?.address ?? null}
      onDone={() => { setEditing(false); load() }} onCancel={view.kind === 'setup' ? undefined : () => setEditing(false)} />
  }
  return <WeatherPanel view={view} onEdit={() => setEditing(true)} />
}

/** Presentational card for every visible state — also used by the review mockup. */
export function WeatherPanel({ view, onEdit }: { view: Exclude<WeatherView, { kind: 'hidden' } | { kind: 'setup' }>; onEdit?: () => void }) {
  const tz = view.timezone
  const manage = view.canManage && onEdit
    ? <button className="link wx-edit" onClick={onEdit}>Change venue</button> : null

  if (view.kind === 'not_yet' || view.kind === 'pending' || view.kind === 'unavailable') {
    return (
      <section className="card weather wx-compact" aria-label="Weather">
        <WeatherIcon kind="partly" size={28} />
        <p className="small">
          {view.kind === 'not_yet' ? <>The weather forecast for this game appears from <b>{fmtDay(view.availableFrom, tz)}</b>, the day before.</>
            : view.kind === 'pending' ? 'The forecast will appear after the next hourly update.'
            : 'The forecast could not be loaded. It will be tried again at the next hourly update — sign-ups work as normal.'}
        </p>
        {manage}
      </section>
    )
  }

  const updated = fmtDay(view.fetchedAt, tz) === fmtDay(new Date().toISOString(), tz)
    ? fmtTime(view.fetchedAt, tz) : `${fmtShortDay(view.fetchedAt, tz)}, ${fmtTime(view.fetchedAt, tz)}`
  const foot = (
    <div className="wx-foot small muted">
      {view.stale && <p className="wx-warn" role="status">This forecast is out of date — the last successful update was {updated}. It refreshes automatically every hour.</p>}
      {!view.stale && view.lastAttemptFailed && <p className="wx-note">The latest hourly update failed; showing the forecast from {updated}.</p>}
      {!view.complete && <p className="wx-note">Some hours are missing from the latest forecast.</p>}
      <p>Forecast area near {view.venue.address}. Updated {updated}.{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Weather data by Open-Meteo.com</a>{manage && <> · {manage}</>}</p>
      <p>Forecasts can change. Any cancellation will come from your organiser.</p>
    </div>
  )

  if (view.kind === 'day_before') {
    const d = view.daily
    const head = conditionFor(d?.code ?? view.game.code, 1)
    return (
      <section className="card weather" aria-labelledby="wx-title">
        <div className="wx-head">
          <h2 id="wx-title">Weather for {fmtShortDay(view.parts[0] ? new Date(view.parts[0].from).toISOString() : view.fetchedAt, tz)}</h2>
          <span className="wx-tag">Game-day forecast</span>
        </div>
        <div className="wx-summary">
          <WeatherIcon kind={head.key} size={56} />
          <div>
            <p className="wx-cond">{head.label}</p>
            <p className="small">{d ? range(d.tmin, d.tmax) : range(view.game.tmin, view.game.tmax)}
              {d?.popMax != null && <> · up to {pct(d.popMax)} chance of rain in any hour</>}
              {d?.rainSum != null && d.rainSum > 0 && <> · about {d.rainSum.toFixed(1)} mm in total</>}</p>
          </div>
        </div>
        <GameLine s={view.game} label="Around your game" />
        <ul className="wx-parts">
          {view.parts.map(p => {
            const c = conditionFor(p.code, p.label === 'Night' ? 0 : p.label === 'Evening' ? p.day : 1)
            return (
              <li key={p.label} className={p.hasGame ? 'has-game' : undefined}>
                <span className="wx-part-name">{p.label}{p.hasGame && <span className="wx-game-tag">Your game</span>}</span>
                <span className="wx-part-time small muted">{hourLabel(p.from, tz)}–{hourLabel(p.to, tz)}</span>
                <WeatherIcon kind={c.key} size={34} />
                <span className="wx-part-cond small">{p.code == null ? 'No data' : c.label}</span>
                <span className="small"><b>{range(p.tmin, p.tmax)}</b></span>
                <span className="small wx-rain"><Drop />{pct(p.popMax)}</span>
              </li>
            )
          })}
        </ul>
        {foot}
      </section>
    )
  }

  // Game day
  return (
    <section className="card weather" aria-labelledby="wx-title">
      <div className="wx-head">
        <h2 id="wx-title">Weather during your game</h2>
        <span className="wx-tag">Hourly · today</span>
      </div>
      <GameLine s={view.game} label={`${fmtTime(new Date(view.gameStart).toISOString(), tz)} – ${fmtTime(new Date(view.gameEnd).toISOString(), tz)}`} />
      <div className="wx-strip" role="list" tabIndex={0} aria-label="Hourly forecast from one hour before to one hour after the game">
        {view.slots.map(s => {
          const c = conditionFor(s.code, s.day)
          return (
            <div role="listitem" key={s.start} className={['wx-slot', s.inGame ? 'in-game' : '', s.isNow ? 'is-now' : ''].join(' ').trim()}>
              <span className="wx-slot-time">{s.isNow ? 'Now' : hourLabel(s.start, tz)}</span>
              <WeatherIcon kind={c.key} size={36} />
              <span className="wx-slot-cond">{s.code == null ? 'No data' : c.label}</span>
              <span className="wx-slot-temp">{deg(s.temp)}</span>
              <span className="wx-rain small"><Drop /><span className="sr-only">Rain chance </span>{pct(s.pop)}</span>
              {s.wind != null && <span className="small muted">{Math.round(s.wind)} km/h</span>}
            </div>
          )
        })}
      </div>
      <p className="small muted wx-legend"><span className="wx-key" aria-hidden="true" />Highlighted hours overlap the game. Rain chance is for the hour starting at each time.</p>
      {foot}
    </section>
  )
}

function GameLine({ s, label }: { s: Summary; label: string }) {
  if (s.code == null) return null
  const c = conditionFor(s.code, s.day)
  return (
    <div className={`wx-game${s.thunder ? ' wx-game-thunder' : ''}`}>
      <p><b>{label}:</b> {c.label}, {range(s.tmin, s.tmax)}, rain chance up to {pct(s.popMax)}.</p>
      {s.thunder && <p className="small">Thundery showers are forecast. Check the venue’s lightning rules before heading out.</p>}
    </div>
  )
}

function Drop() {
  return <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M5 .8C3.6 3 1.2 5.6 1.2 7.6a3.8 3.8 0 0 0 7.6 0C8.8 5.6 6.4 3 5 .8z" fill="#2e7a5b" /></svg>
}

type Place = { address: string; latitude: number; longitude: number }

/** Organiser/admin: confirm the address PickleMe should forecast for this game's location text. */
export function VenueSetup({ gameId, location, current, onDone, onCancel }: {
  gameId: string; location: string; current: string | null; onDone: () => void; onCancel?: () => void
}) {
  const toast = useToast()
  const [q, setQ] = useState(location)
  const [results, setResults] = useState<Place[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [picked, setPicked] = useState<Place | null>(null)
  const [manual, setManual] = useState(false)
  const [m, setM] = useState({ address: '', lat: '', lon: '' })
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(!!current)

  async function search(e?: FormEvent) {
    e?.preventDefault()
    if (!q.trim()) return
    setSearching(true); setSearchError(false); setPicked(null)
    try { setResults(await searchOneMap(q.trim())) } catch { setResults(null); setSearchError(true) }
    setSearching(false)
  }
  async function save(p: Place) {
    setBusy(true)
    try { await api.saveWeatherVenue(gameId, p.address, p.latitude, p.longitude); toast('Weather venue saved.'); onDone() }
    catch (e) { toast(friendlyError(e), 'error') }
    setBusy(false)
  }
  async function remove() {
    setBusy(true)
    try { await api.removeWeatherVenue(gameId); toast('Weather turned off for this venue.'); onDone() }
    catch (e) { toast(friendlyError(e), 'error') }
    setBusy(false)
  }
  const manualPlace = (): Place | null => {
    const lat = Number(m.lat), lon = Number(m.lon)
    return m.address.trim() && Number.isFinite(lat) && Number.isFinite(lon) && m.lat.trim() && m.lon.trim()
      && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { address: m.address.trim(), latitude: lat, longitude: lon } : null
  }

  if (!open) {
    return (
      <section className="card weather wx-compact wx-setup-prompt">
        <WeatherIcon kind="partly" size={28} />
        <p className="small"><b>Show weather for “{location}”?</b> Confirm the venue address once and every game here gets an hourly forecast. Only organisers see this.</p>
        <button className="btn btn-sm" onClick={() => setOpen(true)}>Set up weather</button>
      </section>
    )
  }

  return (
    <section className="card weather wx-setup" aria-labelledby="wx-setup-title">
      <h2 id="wx-setup-title">Weather venue for “{location}”</h2>
      {current && <p className="small">Currently forecasting for <b>{current}</b>.</p>}
      <p className="small muted">Pick the address of this venue. It is saved for every game in this group with the same location, and stops applying if a game’s location is changed. Search uses OneMap; only the text you type is sent.</p>
      {!manual && <>
        <form className="row" onSubmit={search}>
          <input value={q} onChange={e => setQ(e.target.value)} aria-label="Search for the venue address" placeholder="Building, street or postcode" maxLength={120} />
          <button className="btn" disabled={searching || !q.trim()}>{searching ? 'Searching…' : 'Search'}</button>
        </form>
        {searchError && <p className="small wx-warn">Address search is unavailable right now. You can enter the coordinates instead.</p>}
        {results && results.length === 0 && <p className="small muted">No matching addresses. Try the building name, street or postcode.</p>}
        {results && results.length > 0 && (
          <ul className="wx-results" role="list">
            {results.map(r => (
              <li key={`${r.latitude},${r.longitude},${r.address}`}>
                <label className="wx-result">
                  <input type="radio" name="wx-place" checked={picked === r} onChange={() => setPicked(r)} />
                  <span>{r.address}<span className="small muted wx-coords">{r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}</span></span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </>}
      {manual && (
        <div className="stack">
          <label className="field">Address<input value={m.address} maxLength={200} onChange={e => setM({ ...m, address: e.target.value })} /></label>
          <div className="row">
            <label className="field">Latitude<input inputMode="decimal" value={m.lat} onChange={e => setM({ ...m, lat: e.target.value })} placeholder="1.33335" /></label>
            <label className="field">Longitude<input inputMode="decimal" value={m.lon} onChange={e => setM({ ...m, lon: e.target.value })} placeholder="103.96567" /></label>
          </div>
        </div>
      )}
      <div className="row wrap">
        <button className="btn btn-primary" disabled={busy || !(manual ? manualPlace() : picked)}
          onClick={() => { const p = manual ? manualPlace() : picked; if (p) save(p) }}>{busy ? 'Saving…' : 'Use this venue'}</button>
        <button className="btn btn-ghost" onClick={() => setManual(!manual)}>{manual ? 'Search instead' : 'Enter coordinates'}</button>
        {onCancel ? <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          : <button className="btn btn-ghost" onClick={() => setOpen(false)}>Not now</button>}
        {current && <ConfirmButton className="btn btn-danger-ghost" confirmText="Tap again to turn off" disabled={busy} onConfirm={remove}>Turn off weather</ConfirmButton>}
      </div>
    </section>
  )
}

async function searchOneMap(q: string): Promise<Place[]> {
  const u = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`
  const res = await fetch(u, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error('search_failed')
  const body = await res.json() as { results?: { ADDRESS?: string; LATITUDE?: string; LONGITUDE?: string }[] }
  const seen = new Set<string>()
  return (body.results ?? []).map(r => ({ address: titleCase(r.ADDRESS ?? ''), latitude: Number(r.LATITUDE), longitude: Number(r.LONGITUDE) }))
    .filter(r => r.address && Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .filter(r => { const k = r.address; if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, 6)
}
function titleCase(s: string) {
  return s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\bSingapore (\d{6})\b/i, 'Singapore $1').replace(/@ Cbp/g, '@ CBP')
}
