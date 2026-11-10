// FR-019 review harness: cancellation note, form and list label from fictional fixtures (no network).
// npm run dev, then open /pickleme/tests/cancel-note.harness.html
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import '../src/styles.css'
import { CancelNote, CancelReasonForm } from '../src/components/CancelNote'
import { renderRosterImage } from '../src/lib/roster-image.js'
import type { Cancellation } from '../src/lib/api'

const tz = 'Asia/Singapore'
const rain: Cancellation = { reason: 'Heavy rain this evening — courts are wet. See you next Tuesday.', reason_code: 'rain',
  cancelled_at: '2026-11-10T08:12:00Z', note_at: '2026-11-10T08:12:00Z', edited: false, note_by_name: 'Jon', note_by_role: 'admin' }
const legacy: Cancellation = { reason: null, reason_code: null, cancelled_at: '2026-11-10T09:59:00Z', note_at: null, edited: false, note_by_name: 'Jon', note_by_role: 'admin' }

function Card({ title, reason }: { title: string; reason: string | null }) {
  return <button className="game-card">
    <div className="game-card-date"><span className="day">Tue 10 Nov</span><span className="time">6:00 pm – 9:00 pm</span></div>
    <div className="game-card-body"><strong className="title">{title}</strong><span className="muted">CBP1 L6 Multi-purpose Courts</span>{reason && <span className="cancel-card-reason">{reason}</span>}
      <div className="meter"><span style={{ width: '60%' }} /></div><span className="small">10/16 playing · 6 spots left</span></div>
    <div className="game-card-status"><span className="cancel-label"><span aria-hidden="true" className="cancel-label-i">i</span>Cancelled</span></div>
  </button>
}
function Roster() {
  const [src, setSrc] = useState('')
  if (!src) renderRosterImage({ title: 'CANCELLED: Cheetos Tuesday (Weekly Game)', date: 'Tuesday, 10 November 2026', time: '6:00 pm – 9:00 pm (Asia/Singapore)',
    location: 'CBP1 L6 Multi-purpose Courts', capacity: 16, playing: ['Jon', 'Kev', 'Marcus', 'Aisha', 'Wei Ling'], waitlist: [],
    snapshot: '10 Nov 2026, 16:15:00 (Asia/Singapore)', cancelNote: 'Note from Jon (Admin): Heavy rain this evening — courts are wet. See you next Tuesday.' })
    .then(b => setSrc(URL.createObjectURL(b)))
  return src ? <img id="roster" src={src} alt="" style={{ width: 900, border: '1px solid #ddd' }} /> : null
}
function App() {
  return <main className="stack-lg" style={{ maxWidth: 940, margin: '0 auto', padding: 16 }}>
    <h2>Game page — player view</h2>
    <header className="game-head"><h1 className="display">Cheetos Tuesday (Weekly Game)</h1>
      <CancelNote cancellation={rain} tz={tz} canEdit={false} onEdit={() => {}} /></header>
    <h2>Organiser view, edited note</h2>
    <CancelNote cancellation={{ ...rain, edited: true, note_by_role: 'organiser', note_by_name: 'Kev' }} tz={tz} canEdit onEdit={() => {}} />
    <h2>Cancelled before FR-019 (organiser view)</h2>
    <CancelNote cancellation={legacy} tz={tz} canEdit onEdit={() => {}} />
    <h2>Cancel form</h2>
    <section className="organiser card"><h2>Organiser tools</h2><CancelReasonForm mode="cancel" busy={false} onSubmit={() => {}} onClose={() => {}} /></section>
    <h2>Cancel form — Rain chosen</h2>
    <section className="organiser card"><CancelReasonForm mode="cancel" initial={{ ...rain, reason: 'Rain / wet courts.' }} busy={false} onSubmit={() => {}} onClose={() => {}} /></section>
    <h2>Games list</h2>
    <ul className="game-list"><li><Card title="Cheetos Tuesday (Weekly Game)" reason="Heavy rain this evening — courts are wet. See you next Tuesday." /></li>
      <li><Card title="Tuesday Socials (Weekly Game)" reason={null} /></li></ul>
    <h2>Roster image</h2><Roster />
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
