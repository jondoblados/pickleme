// FR-021 review harness: the real screens and components with fictional fixtures (API calls are stubbed; no network).
// npm run dev, then open /pickleme/tests/fees.harness.html?view=create|list|player|gameday|organiser|roster
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import '../src/styles.css'
import { api, type GameDetail, type GameSummary, type Me } from '../src/lib/api'
import { ToastProvider } from '../src/components/ui'
import { GameForm } from '../src/screens/GameForm'
import { Home } from '../src/screens/Home'
import { ConfirmSlotCard, FeeCard, FeeChangedNotice, SlotConfirmationsPanel } from '../src/components/FeeCards'
import { renderRosterImage } from '../src/lib/roster-image.js'
import { costLine } from '../src/lib/fees.js'
import { shareMessage } from '../src/screens/GamePage'

const tz = 'Asia/Singapore'
const group: Me['groups'][number] = { id: 'g1', name: 'Thursday Socials', role: 'organiser', timezone: tz, default_capacity: 12 }
const day = (iso: string, h = 11) => `${iso}T${String(h).padStart(2, '0')}:00:00.000Z` // 11:00Z = 7 pm SGT
const fee = (total: number, basis: number, cap: number) => ({ total_cents: total, currency: 'SGD' as const, basis,
  share_cents: basis ? Math.ceil(total / basis) : null, share_if_full_cents: Math.ceil(total / cap), final: false,
  previous_cents: null, updated_at: null })
const summary = (id: string, date: string, playing: number, f: number | null, visibleFrom: string | null, vis: GameSummary['visibility'] = 'two_weeks_before'): GameSummary => ({
  id, group_id: 'g1', group_name: group.name, timezone: tz, title: 'Thursday Socials', starts_at: day(date), ends_at: day(date, 13),
  location: 'Community Sports Hall, Courts 3–4', capacity: 12, status: 'open', playing, waitlist: 0, me: { status: null },
  visibility: vis, visible_from: visibleFrom, fee: f == null ? null : fee(f, playing, 12) })
const games: GameSummary[] = [
  summary('a', '2027-01-07', 8, 4800, null, 'now'),
  summary('b', '2027-01-14', 0, 4800, day('2026-12-31')),
  summary('c', '2027-01-21', 0, 4800, day('2027-01-07')),
  summary('d', '2027-01-28', 0, null, day('2027-01-14')),
]
const names = ['Alicia Lim', 'Ben Tan', 'Carlos Reyes', 'Diana Wong', 'Ethan Koh', 'Farah Aziz', 'Gary Ong', 'Hui Min', 'Ivan Lee', 'Jon Doblados', 'Kev Tan']
const roster = names.map((n, i) => ({ user_id: `u${i}`, display_name: n, avatar_path: null, joined_at: day('2027-01-01'), rank: i + 1, status: 'playing' as const, position: i + 1 }))
const now = Date.now()
const detail = (players: number, opts: Partial<GameDetail> = {}, game: Partial<GameDetail['game']> = {}): GameDetail => ({
  game: { id: 'a', title: 'Thursday Socials', starts_at: day('2027-01-07'), ends_at: day('2027-01-07', 13), location: 'Community Sports Hall, Courts 3–4',
    capacity: 12, notes: '', status: 'open', updated_at: day('2027-01-01'), visibility: 'now', visible_from: null,
    fee: { ...fee(4800, players, 12), changed_since_join: false, payee: { kind: 'organiser', name: 'Jon Doblados', mobile: '+6591234567' } }, ...game },
  group: { id: 'g1', name: group.name, timezone: tz }, my_role: 'player', me: { status: 'playing', position: 4 },
  roster: roster.slice(0, players), confirmation: null, ...opts })

Object.assign(api, {
  // The create view copies the last game: a paid one, scheduled 2 weeks before.
  listGames: async (past: boolean) => past ? [] : new URLSearchParams(location.search).get('view') === 'create' ? games.slice(0, 3) : games,
  getGameFeeSettings: async () => ({ total_cents: 4800, currency: 'SGD', payee: { kind: 'organiser', name: null, mobile: '+6591234567', user_id: 'me' } }),
  listSlotConfirmations: async () => roster.map((r, i) => ({ user_id: r.user_id, name: r.display_name, avatar_path: null, position: i + 1,
    confirmed_at: i < 9 ? new Date(now - (9 - i) * 1800_000).toISOString() : null,
    mobile: i < 9 ? ['+6598765432', '+6581230099', '+639171234567', '+6590011223', '+6587776655', '+60123456789', '+6593334444', '+6582221111', '+6596665555'][i] : null })),
})

function Roster() {
  const [src, setSrc] = useState('')
  const d = detail(8)
  if (!src) renderRosterImage({ title: 'Thursday Socials', date: 'Thursday, 7 January 2027', time: '7:00 pm – 9:00 pm (Asia/Singapore)',
    location: 'Community Sports Hall, Courts 3–4', capacity: 12, playing: names.slice(0, 8), waitlist: [],
    snapshot: '5 Jan 2027, 20:15:00 (Asia/Singapore)', costLine: costLine(d.game.fee!) }).then(b => setSrc(URL.createObjectURL(b)))
  return <div className="stack">
    {src && <img src={src} alt="" style={{ width: '100%', maxWidth: 600 }} />}
    <label className="field"><span>WhatsApp message</span><textarea readOnly rows={16} value={shareMessage(d, 'https://jon.doblados.net/pickleme/?game=…')} /></label>
  </div>
}
function Head({ d, today }: { d: GameDetail; today?: boolean }) {
  return <header className="game-head"><span className="badge badge-open">Open for sign-ups</span><h1 className="display">{d.game.title}</h1>
    <dl className="facts"><div><dt>Date</dt><dd>{today ? 'Today' : 'Thursday 7 January'}</dd></div><div><dt>Time</dt><dd>7:00 pm – 9:00 pm</dd></div>
      <div><dt>Where</dt><dd>{d.game.location}</dd></div><div><dt>Players</dt><dd>{d.roster.length} / {d.game.capacity}</dd></div></dl></header>
}

function App() {
  const view = new URLSearchParams(location.search).get('view') ?? 'create'
  const go = () => {}
  const sgToday = new Date(now).toLocaleDateString('en-CA', { timeZone: tz })
  const opens = new Date(`${sgToday}T00:00:00+08:00`).toISOString(), closes = new Date(`${sgToday}T19:00:00+08:00`).toISOString()
  let body
  if (view === 'create') body = <GameForm group={group} go={go} />
  else if (view === 'list') body = <Home group={group} go={go} />
  else if (view === 'player') {
    const d = detail(8, { me: { status: null } })
    body = <article className="stack-lg game-page"><Head d={d} />
      <section className="me-card me-none"><div><p className="me-label">Your status</p><p className="me-status">Not signed up</p><p className="small me-help">4 spots left.</p></div>
        <div className="me-actions"><button className="btn btn-primary btn-lg">Join game</button><p className="small muted">By joining, you agree to pay your share to the organiser.</p></div></section>
      <FeeCard game={{ ...d.game, fee: { ...d.game.fee!, payee: null } }} /></article>
  } else if (view === 'gameday') {
    const d = detail(11, { confirmation: { required: true, open: true, opens_at: opens, closes_at: closes, confirmed_at: null } },
      { fee: { ...fee(4800, 11, 12), changed_since_join: true, previous_cents: 4000, updated_at: '2027-01-05T00:00:00Z', payee: { kind: 'organiser', name: 'Jon Doblados', mobile: '+6591234567' } } })
    body = <article className="stack-lg game-page"><Head d={d} today /><FeeChangedNotice game={d.game} /><ConfirmSlotCard data={d} onDone={() => {}} /><FeeCard game={d.game} /></article>
  } else if (view === 'organiser') {
    const d = detail(11, { my_role: 'organiser', confirmation: { required: false, open: true, opens_at: opens, closes_at: closes, confirmed_at: null } })
    body = <article className="stack-lg game-page"><Head d={d} today /><SlotConfirmationsPanel data={d} refreshKey="x" /></article>
  } else body = <Roster />
  return <ToastProvider><main className="stack-lg" style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>{body}</main></ToastProvider>
}
createRoot(document.getElementById('root')!).render(<App />)
