// FR-021: court booking fee, payment details and game-day slot confirmation on the game page.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type GameDetail, type SlotConfirmationRow } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { copyText } from '../lib/clipboard'
import { fmtShortDay, fmtTime } from '../lib/time'
import { COUNTRY_CODES, buildMobile, formatMobile, formatSgd } from '../lib/fees.js'
import { Notice, useToast } from './ui'
import { Avatar } from './Avatar'

type Game = GameDetail['game']

/** Cost summary, shown to everyone who can see the game (before and after joining). */
export function FeeCard({ game }: { game: Game }) {
  const toast = useToast()
  const fee = game.fee
  if (!fee) return null
  const share = fee.share_cents
  const started = new Date(game.starts_at).getTime() <= Date.now()
  return (
    <section className="card fee-card stack" aria-label="Court booking fee">
      <div className="fee-head">
        <h2>Court booking fee</h2>
        <p className="fee-share">{share != null ? <>{fee.final ? '' : '≈ '}{formatSgd(share)} <span className="muted small">each{fee.final ? ' (final)' : ''}</span></>
          : <span className="muted small">Share shown after sign-ups</span>}</p>
      </div>
      <dl className="fee-facts">
        <div><dt>Total for this game</dt><dd>{formatSgd(fee.total_cents)}</dd></div>
        <div><dt>Split between</dt><dd>{fee.basis} {started ? 'on the list' : 'playing'}</dd></div>
        {!started && fee.share_if_full_cents != null && <div><dt>If all {game.capacity} places fill</dt><dd>{formatSgd(fee.share_if_full_cents)} each</dd></div>}
      </dl>
      <p className="small muted">{fee.final ? 'Final share: everyone on the attendance list except players marked Excused.'
        : started ? 'After the game, the fee is split between everyone on the attendance list except players marked Excused. Unexcused no-shows still pay.'
        : 'Your share changes as people join or withdraw. Waitlisted players don\u2019t pay unless they move up.'}</p>
      {fee.payee && (
        <div className="pay-box stack-sm">
          <p className="me-label">Pay your share by PayNow</p>
          <dl className="fee-facts">
            <div><dt>PayNow to</dt><dd>{fee.payee.name}</dd></div>
            <div><dt>Mobile</dt><dd className="row">{formatMobile(fee.payee.mobile)}
              <button type="button" className="btn btn-xs" onClick={async () =>
                toast(await copyText(fee.payee!.mobile) ? 'PayNow number copied.' : 'Could not copy.')}>Copy</button></dd></div>
          </dl>
          <p className="small muted">Pay in your banking app. PickleMe doesn&rsquo;t handle payments.</p>
        </div>
      )}
    </section>
  )
}

/** Shown once per change to players who joined before the fee was added or changed. */
export function FeeChangedNotice({ game }: { game: Game }) {
  const fee = game.fee
  const key = `pm:fee-seen:${game.id}:${fee?.updated_at ?? ''}`
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  useEffect(() => { try { setDismissed(localStorage.getItem(key) === '1') } catch { /* private mode */ } }, [key])
  if (!fee || !fee.changed_since_join || dismissed) return null
  const text = fee.previous_cents == null
    ? `The organiser added a court booking fee of ${formatSgd(fee.total_cents)} after you joined.`
    : `The court booking fee changed from ${formatSgd(fee.previous_cents)} to ${formatSgd(fee.total_cents)} after you joined.`
  return (
    <Notice tone="info">
      <span className="row between wrap">{text} If you can&rsquo;t pay your share, you can withdraw.
        <button className="link" onClick={() => { try { localStorage.setItem(key, '1') } catch { /* ignore */ } setDismissed(true) }}>Dismiss</button></span>
    </Notice>
  )
}

/** Game day, paid games: a playing member enters a mobile number to confirm their place. */
export function ConfirmSlotCard({ data, onDone }: { data: GameDetail; onDone: () => void }) {
  const toast = useToast()
  const c = data.confirmation
  const [cc, setCc] = useState('+65')
  const [num, setNum] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  if (!c || !c.required) return null
  const tz = data.group.timezone
  if (!c.open && !c.confirmed_at) {
    if (new Date(c.closes_at).getTime() <= Date.now()) return null
    return <p className="small muted confirm-later">This is a paid game. On game day (from {fmtShortDay(c.opens_at, tz)}, 12:00 am until {fmtTime(c.closes_at, tz)}), you&rsquo;ll be asked to confirm your slot with your mobile number.</p>
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    const m = buildMobile(cc, num)
    if (!m.ok) { setError(m.error); return }
    setBusy(true); setError(null)
    try { await api.confirmSlot(data.game.id, m.mobile); toast('Slot confirmed.'); setEditing(false); setNum(''); onDone() }
    catch (err) { setError(friendlyError(err)) }
    setBusy(false)
  }
  if (c.confirmed_at && !editing) return (
    <section className="card confirm-card confirm-done">
      <p><b>Slot confirmed</b> at {fmtTime(c.confirmed_at, tz)}.</p>
      {c.open && <button className="link" onClick={() => setEditing(true)}>Change number</button>}
    </section>
  )
  return (
    <form className="card confirm-card stack" onSubmit={submit}>
      <h2>Confirm your slot for today</h2>
      <p className="small">This is a paid game. Enter your mobile number to confirm you&rsquo;re playing. Open until {fmtTime(c.closes_at, tz)}.</p>
      <div className="field"><span>Mobile number</span>
        <div className="mobile-input">
          <select aria-label="Country code" value={cc} onChange={e => setCc(e.target.value)}>
            {COUNTRY_CODES.map(x => <option key={x.code} value={x.code}>{x.code} {x.label}</option>)}
          </select>
          <input type="tel" inputMode="tel" autoComplete="tel-national" value={num} maxLength={20}
            onChange={e => setNum(e.target.value)} placeholder="9876 5432" aria-label="Mobile number" required />
        </div>
        <small className="muted">Any country code, as on WhatsApp. You can also type the full number starting with +.</small>
      </div>
      <p className="small muted">Only the organiser and group admins can see this number. It&rsquo;s used for this game only, isn&rsquo;t saved to your profile, and is deleted 30 days after the game.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Confirming…' : 'Confirm my slot'}</button>
    </form>
  )
}

/** Organisers and admins: who has confirmed, with their numbers. */
export function SlotConfirmationsPanel({ data, refreshKey }: { data: GameDetail; refreshKey: string }) {
  const [rows, setRows] = useState<SlotConfirmationRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = data.game.id
  const load = useCallback(async () => {
    try { setRows(await api.listSlotConfirmations(id)); setError(null) } catch (e) { setError(friendlyError(e)) }
  }, [id])
  useEffect(() => { load() }, [load, refreshKey])
  const c = data.confirmation
  if (!data.game.fee || !c) return null
  const tz = data.group.timezone
  const dayOf = Date.now() >= new Date(c.opens_at).getTime()
  if (!dayOf) return null
  const done = rows?.filter(r => r.confirmed_at).length ?? 0
  return (
    <section className="card confirmations stack">
      <div className="row between"><h2>Slot confirmations <span className="count">{done} of {rows?.length ?? '–'}</span></h2>
        <button className="btn btn-xs" onClick={load}>Refresh</button></div>
      {error && <Notice tone="error">{error}</Notice>}
      {rows && rows.length === 0 && <p className="muted">No one on the playing list.</p>}
      {rows && rows.length > 0 && <ol className="roster">
        {rows.map(r => <li key={r.user_id}>
          <span className="pos">{r.position}</span>
          <Avatar userId={r.user_id} name={r.name} path={r.avatar_path} size={32} />
          <span className="name">{r.name}<span className="small muted att-note">{r.confirmed_at ? `Confirmed ${fmtTime(r.confirmed_at, tz)}` : 'Not confirmed yet'}</span></span>
          {r.mobile ? <a className="small mono" href={`tel:${r.mobile}`}>{formatMobile(r.mobile)}</a> : <span className="chip chip-waitlist">Pending</span>}
        </li>)}
      </ol>}
      <p className="small muted">Numbers are visible only to organisers and admins, and are deleted 30 days after the game. Confirming a slot doesn&rsquo;t mark attendance or payment.</p>
    </section>
  )
}
