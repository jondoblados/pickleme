import { useEffect, useState, type FormEvent } from 'react'
import { api, type Me, type PayeeKind, type Visibility } from '../lib/api'
import { friendlyError } from '../lib/errors'
import type { Route } from '../lib/route'
import { addDaysLocal, fmtShortDay, fmtTime, isoToLocalInput, localInputToIso, nextWeekdayAt } from '../lib/time'
import { checkPayNowMobile, formatMobile, formatSgd, parseSgd, shareCents, visibleFrom } from '../lib/fees.js'
import { Notice, Spinner, useToast } from '../components/ui'

interface FormState { title: string; date: string; start: string; end: string; location: string; capacity: number; notes: string
  visibility: Visibility
  /** FR-021: optional court booking fee, as typed (SGD). */
  fee: string; payeeKind: PayeeKind; payeeName: string; payeeMobile: string }

const PAYNOW_KEY = 'pm:paynow-mobile' // the organiser's own PayNow number, remembered on this device only
const blankFee = () => ({ fee: '', payeeKind: 'organiser' as PayeeKind, payeeName: '',
  payeeMobile: (() => { try { return localStorage.getItem(PAYNOW_KEY) ?? '' } catch { return '' } })() })
const VISIBILITY: { value: Visibility; label: string }[] = [
  { value: 'now', label: 'Visible now' }, { value: 'week_before', label: '1 week before' },
  { value: 'two_weeks_before', label: '2 weeks before' },
]

function feeFields(fs: { total_cents: number | null; payee: { kind: PayeeKind; name: string | null; mobile: string } | null }) {
  if (fs.total_cents == null || !fs.payee) return blankFee()
  return { fee: (fs.total_cents / 100).toFixed(2), payeeKind: fs.payee.kind, payeeName: fs.payee.name ?? '',
    payeeMobile: formatMobile(fs.payee.mobile) }
}

export function GameForm({ group, gameId, go }: { group: Me['groups'][number]; gameId?: string; go: (r: Route) => void }) {
  const toast = useToast()
  const tz = group.timezone
  const [form, setForm] = useState<FormState | null>(null)
  const [minCapacity, setMinCapacity] = useState(1)
  const [playersJoined, setPlayersJoined] = useState(0)
  const [savedFee, setSavedFee] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        if (gameId) {
          const d = await api.getGame(gameId)
          const s = isoToLocalInput(d.game.starts_at, tz), e = isoToLocalInput(d.game.ends_at, tz)
          setMinCapacity(Math.max(1, Math.min(d.roster.length, d.game.capacity)))
          setPlayersJoined(d.roster.filter(r => r.status === 'playing').length)
          const fs = await api.getGameFeeSettings(gameId)
          setSavedFee(fs.total_cents)
          setForm({ title: d.game.title, date: s.slice(0, 10), start: s.slice(11), end: e.slice(11),
            location: d.game.location, capacity: d.game.capacity, notes: d.game.notes,
            visibility: d.game.visibility ?? 'now', ...feeFields(fs) })
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
            // Copy the visibility and fee too, so a season of weekly games can be entered quickly.
            const fs = last.fee ? await api.getGameFeeSettings(last.id).catch(() => null) : null
            setForm({ title: last.title, date: s.slice(0, 10), start: s.slice(11), end: e.slice(11),
              location: last.location, capacity: last.capacity, notes: '', visibility: last.visibility ?? 'now',
              ...(fs ? feeFields(fs) : blankFee()) })
          } else {
            const s = nextWeekdayAt(2, 19, 0, tz)
            setForm({ title: 'Tuesday Socials', date: s.slice(0, 10), start: '19:00', end: '21:00',
              location: 'CBP1', capacity: group.default_capacity, notes: '', visibility: 'now', ...blankFee() })
          }
        }
      } catch (e) { setError(friendlyError(e)) }
    })()
  }, [gameId, group.id, group.default_capacity, tz])

  if (!form) return error ? <Notice tone="error">{error}</Notice> : <Spinner />
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => f && { ...f, [k]: v })

  const feeCents = parseSgd(form.fee)
  const startIso = form.date && form.start ? localInputToIso(`${form.date}T${form.start}`, tz) : null
  const visibleLabel = (v: Visibility) => {
    const at = visibleFrom(v, startIso)
    return at ? `Visible from ${fmtShortDay(at, tz)}, ${fmtTime(at, tz)}` : 'Default. Players can see and join straight away.'
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.title.trim()) { setError('Please enter a title.'); return }
    const startsAt = localInputToIso(`${form.date}T${form.start}`, tz)
    // End time earlier than start time means the game finishes after midnight.
    const endDate = form.end <= form.start ? addDaysLocal(`${form.date}T${form.end}`, 1) : `${form.date}T${form.end}`
    const endsAt = localInputToIso(endDate, tz)
    if (!gameId && new Date(startsAt).getTime() < Date.now()) { setError('The start time is in the past.'); return }
    const cents = parseSgd(form.fee)
    if (Number.isNaN(cents)) { setError('Enter the court fee as an amount in SGD, such as 48.00, or leave it blank.'); return }
    let payee: { kind: PayeeKind; name?: string; mobile: string } | undefined
    if (cents != null) {
      const m = checkPayNowMobile(form.payeeMobile)
      if (!m.ok) { setError(m.error); return }
      if (form.payeeKind === 'nominated' && !form.payeeName.trim()) { setError('Enter the name of the person players pay.'); return }
      payee = { kind: form.payeeKind, name: form.payeeKind === 'nominated' ? form.payeeName.trim() : undefined, mobile: m.mobile }
      if (form.payeeKind === 'organiser') { try { localStorage.setItem(PAYNOW_KEY, m.mobile) } catch { /* private mode */ } }
    }
    setBusy(true); setError(null)
    try {
      const payload = { title: form.title.trim(), startsAt, endsAt, location: form.location.trim(), capacity: form.capacity,
        notes: form.notes.trim(), visibility: form.visibility }
      if (gameId) {
        const r = await api.updateGame(gameId, payload)
        if (cents != null || savedFee != null) await api.setGameFee(gameId, cents, payee)
        toast(r.promoted ? `Saved. ${r.promoted} moved off the waitlist.` : 'Game updated.')
        go({ name: 'game', gameId })
      } else {
        const id = await api.createGame({ groupId: group.id, ...payload })
        if (cents != null) {
          try { await api.setGameFee(id, cents, payee) } catch (err) {
            // The game exists; send the organiser to edit it rather than creating a duplicate.
            toast(`Game created, but the fee was not saved: ${friendlyError(err)}`, 'error')
            go({ name: 'edit-game', gameId: id }); setBusy(false); return
          }
        }
        toast(form.visibility === 'now' ? 'Game created — now share it in WhatsApp.'
          : `Game created. Players will see it from ${fmtShortDay(visibleFrom(form.visibility, startsAt)!, tz)}.`)
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
        <fieldset className="field choice-group">
          <legend>When should players see this game?</legend>
          {VISIBILITY.map(v => (
            <label key={v.value} className={`choice${form.visibility === v.value ? ' is-selected' : ''}`}>
              <input type="radio" name="visibility" value={v.value} checked={form.visibility === v.value}
                onChange={() => set('visibility', v.value)} />
              <span><strong>{v.label}</strong><small className="muted">{visibleLabel(v.value)}</small></span>
            </label>
          ))}
          {form.visibility !== 'now' && <small className="muted">Until then, only organisers and admins can see this game. Shared links won't open it for players.</small>}
          {gameId && playersJoined > 0 && <small className="muted">Players have joined, so this game can't be hidden again.</small>}
        </fieldset>
        <label className="field"><span>Notes <span className="muted">(optional)</span></span>
          <textarea rows={3} maxLength={1000} value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="What to bring, parking…" /></label>
        <p className="small muted">Times are in {tz.replace('_', ' ')}.</p>
      </div>
      <div className="card stack">
        <h2>Court booking fee <span className="muted small">(optional)</span></h2>
        <p className="small muted">Booked outside PickleMe. Leave blank if the game is free — you can add it later.</p>
        <label className="field"><span>Total fee for this game (SGD)</span>
          <input inputMode="decimal" value={form.fee} placeholder="e.g. 48.00" maxLength={10}
            onChange={e => set('fee', e.target.value)} />
          {feeCents != null && !Number.isNaN(feeCents) && <small className="muted">
            {playersJoined > 0 ? `≈ ${formatSgd(shareCents(feeCents, playersJoined))} each with ${playersJoined} playing. `
              : `≈ ${formatSgd(shareCents(feeCents, form.capacity))} per player if all ${form.capacity} places fill. `}
            Players see the live share based on sign-ups.</small>}
          {gameId && playersJoined > 0 && feeCents !== savedFee && <small className="muted">Players who have already joined will see a notice that the fee changed.</small>}
        </label>
        {feeCents != null && !Number.isNaN(feeCents) && <>
          <fieldset className="field choice-group">
            <legend>Players pay by PayNow to</legend>
            <label className={`choice${form.payeeKind === 'organiser' ? ' is-selected' : ''}`}>
              <input type="radio" name="payee" checked={form.payeeKind === 'organiser'} onChange={() => set('payeeKind', 'organiser')} />
              <span><strong>Me (organiser)</strong></span>
            </label>
            <label className={`choice${form.payeeKind === 'nominated' ? ' is-selected' : ''}`}>
              <input type="radio" name="payee" checked={form.payeeKind === 'nominated'} onChange={() => set('payeeKind', 'nominated')} />
              <span><strong>Another mobile number</strong><small className="muted">e.g. the person who booked the courts</small></span>
            </label>
          </fieldset>
          {form.payeeKind === 'nominated' && <label className="field"><span>Their name</span>
            <input value={form.payeeName} maxLength={60} onChange={e => set('payeeName', e.target.value)} placeholder="Name shown to players" /></label>}
          <label className="field"><span>PayNow mobile number</span>
            <input type="tel" inputMode="tel" autoComplete="tel" value={form.payeeMobile} maxLength={16}
              onChange={e => set('payeeMobile', e.target.value)} placeholder="+65 9123 4567" />
            <small className="muted">Singapore mobile registered for PayNow. Shown only to players in this game.</small>
          </label>
        </>}
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn btn-primary btn-lg" disabled={busy} type="submit">{busy ? 'Saving…' : gameId ? 'Save changes' : 'Create game'}</button>
      </div>
    </form>
  )
}
