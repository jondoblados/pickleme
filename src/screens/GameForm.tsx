import { useEffect, useState, type FormEvent } from 'react'
import { api, type Me } from '../lib/api'
import { friendlyError } from '../lib/errors'
import type { Route } from '../lib/route'
import { addDaysLocal, isoToLocalInput, localInputToIso, nextWeekdayAt } from '../lib/time'
import { Notice, Spinner, useToast } from '../components/ui'

interface FormState { title: string; date: string; start: string; end: string; location: string; capacity: number; notes: string }

export function GameForm({ group, gameId, go }: { group: Me['groups'][number]; gameId?: string; go: (r: Route) => void }) {
  const toast = useToast()
  const tz = group.timezone
  const [form, setForm] = useState<FormState | null>(null)
  const [minCapacity, setMinCapacity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        if (gameId) {
          const d = await api.getGame(gameId)
          const s = isoToLocalInput(d.game.starts_at, tz), e = isoToLocalInput(d.game.ends_at, tz)
          setMinCapacity(Math.max(1, Math.min(d.roster.length, d.game.capacity)))
          setForm({ title: d.game.title, date: s.slice(0, 10), start: s.slice(11), end: e.slice(11),
            location: d.game.location, capacity: d.game.capacity, notes: d.game.notes })
        } else {
          // Default: copy the most recent game one week later, else next Tuesday 7–9pm.
          const [upcoming, past] = await Promise.all([api.listGames(false), api.listGames(true)])
          const all = [...upcoming, ...past]
            .filter(g => g.group_id === group.id && g.status !== 'cancelled')
            .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
          const last = all[0]
          if (last) {
            let s = isoToLocalInput(last.starts_at, tz)
            const e = isoToLocalInput(last.ends_at, tz)
            do { s = addDaysLocal(s, 7) } while (new Date(localInputToIso(s, tz)).getTime() < Date.now())
            setForm({ title: last.title, date: s.slice(0, 10), start: s.slice(11), end: e.slice(11),
              location: last.location, capacity: last.capacity, notes: '' })
          } else {
            const s = nextWeekdayAt(2, 19, 0, tz)
            setForm({ title: 'Tuesday Socials', date: s.slice(0, 10), start: '19:00', end: '21:00',
              location: 'CBP1', capacity: group.default_capacity, notes: '' })
          }
        }
      } catch (e) { setError(friendlyError(e)) }
    })()
  }, [gameId, group.id, group.default_capacity, tz])

  if (!form) return error ? <Notice tone="error">{error}</Notice> : <Spinner />
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => f && { ...f, [k]: v })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.title.trim()) { setError('Please enter a title.'); return }
    const startsAt = localInputToIso(`${form.date}T${form.start}`, tz)
    // End time earlier than start time means the game finishes after midnight.
    const endDate = form.end <= form.start ? addDaysLocal(`${form.date}T${form.end}`, 1) : `${form.date}T${form.end}`
    const endsAt = localInputToIso(endDate, tz)
    if (!gameId && new Date(startsAt).getTime() < Date.now()) { setError('The start time is in the past.'); return }
    setBusy(true); setError(null)
    try {
      const payload = { title: form.title.trim(), startsAt, endsAt, location: form.location.trim(), capacity: form.capacity, notes: form.notes.trim() }
      if (gameId) {
        const r = await api.updateGame(gameId, payload)
        toast(r.promoted ? `Saved. ${r.promoted} moved off the waitlist.` : 'Game updated.')
        go({ name: 'game', gameId })
      } else {
        const id = await api.createGame({ groupId: group.id, ...payload })
        toast('Game created — now share it in WhatsApp.')
        go({ name: 'game', gameId: id })
      }
    } catch (err) { setError(friendlyError(err)) }
    setBusy(false)
  }

  return (
    <form className="stack-lg" onSubmit={submit}>
      <button type="button" className="link back" onClick={() => go(gameId ? { name: 'game', gameId } : { name: 'home' })}>← Back</button>
      <h1 className="display">{gameId ? 'Edit game' : 'New game'}</h1>
      <div className="card stack">
        <label className="field"><span>Title</span>
          <input value={form.title} maxLength={80} onChange={e => set('title', e.target.value)} required /></label>
        <div className="grid-3">
          <label className="field"><span>Date</span>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} required /></label>
          <label className="field"><span>Start</span>
            <input type="time" value={form.start} step={900} onChange={e => set('start', e.target.value)} required /></label>
          <label className="field"><span>End</span>
            <input type="time" value={form.end} step={900} onChange={e => set('end', e.target.value)} required /></label>
        </div>
        <label className="field"><span>Location</span>
          <input value={form.location} maxLength={120} onChange={e => set('location', e.target.value)} placeholder="Court / venue" /></label>
        <label className="field"><span>Player limit</span>
          <input type="number" inputMode="numeric" min={minCapacity} max={200} value={form.capacity}
            onChange={e => set('capacity', Math.max(1, Math.min(200, Number(e.target.value) || 1)))} required />
          <small className="muted">Everyone after this number goes on the waitlist.{gameId && minCapacity > 1 ? ` Can't go below ${minCapacity} (players already confirmed).` : ''}</small>
        </label>
        <label className="field"><span>Notes <span className="muted">(optional)</span></span>
          <textarea rows={3} maxLength={1000} value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Court fees, what to bring, parking…" /></label>
        <p className="small muted">Times are in {tz.replace('_', ' ')}.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn btn-primary btn-lg" disabled={busy} type="submit">{busy ? 'Saving…' : gameId ? 'Save changes' : 'Create game'}</button>
      </div>
    </form>
  )
}
