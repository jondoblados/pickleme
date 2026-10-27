import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase, APP_URL } from '../lib/supabase'
import { api, isOrganiser, type GameDetail } from '../lib/api'
import { friendlyError } from '../lib/errors'
import type { Route } from '../lib/route'
import { fmtDay, fmtRange } from '../lib/time'
import { copyText } from '../lib/clipboard'
import { ConfirmButton, Notice, Spinner, useToast } from '../components/ui'
import { Avatar } from '../components/Avatar'

export function shareMessage(d: GameDetail, url: string) {
  const tz = d.group.timezone
  return [
    `🏓 ${d.game.title}`,
    '',
    `Date: ${fmtDay(d.game.starts_at, tz)}`,
    `Time: ${fmtRange(d.game.starts_at, d.game.ends_at, tz)}`,
    d.game.location ? `Location: ${d.game.location}` : null,
    `Players: ${d.game.capacity} maximum`,
    '',
    'Join or withdraw using this link:',
    url,
    '',
    'When the game is full, new signups join the waitlist.',
    'If someone withdraws, the next waitlisted player moves in automatically.',
  ].filter(l => l !== null).join('\n')
}

type AttStatus = 'unmarked' | 'present' | 'no_show' | 'excused'
type AttRow = { user_id: string; name: string; status: AttStatus; marked_at: string | null }
type Attendance = { started: boolean; ended: boolean; cancelled: boolean; rows: AttRow[] }
const attLabel: Record<AttStatus, string> = { unmarked: 'Unmarked', present: 'Present', no_show: 'No-show', excused: 'Excused' }

export function GamePage({ gameId, userId, go }: { gameId: string; userId: string; go: (r: Route) => void }) {
  const toast = useToast()
  const [data, setData] = useState<GameDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)
  const reloadTimer = useRef<number | undefined>(undefined)
  const [att, setAtt] = useState<Attendance | null>(null)
  const [marking, setMarking] = useState<string | null>(null)

  // Organisers/admins of a started game also get the attendance list (the playing list frozen at start time).
  const load = useCallback(async () => {
    try {
      const d = await api.getGame(gameId)
      setData(d); setError(null)
      if (isOrganiser(d.my_role) && d.game.status !== 'cancelled' && new Date(d.game.starts_at).getTime() <= Date.now()) {
        const { data: a, error: ae } = await supabase.rpc('get_game_attendance', { p_game_id: gameId })
        if (!ae) setAtt(a as Attendance)
      } else setAtt(null)
    } catch (e) { setError(friendlyError(e)) }
  }, [gameId])

  // Attendance can be changed by another organiser; refresh it every 30 s while visible.
  useEffect(() => {
    if (!att) return
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    return () => window.clearInterval(t)
  }, [att !== null, load]) // eslint-disable-line react-hooks/exhaustive-deps

  async function markAttendance(uid: string, name: string, next: AttStatus) {
    if (!att) return
    const prev = att
    setMarking(uid)
    setAtt({ ...att, rows: att.rows.map(r => r.user_id === uid ? { ...r, status: next } : r) }) // optimistic
    try {
      const { error: e } = await supabase.rpc('mark_game_attendance', { p_game_id: gameId, p_user_id: uid, p_status: next })
      if (e) throw e
      toast(`${name}: ${attLabel[next]}`)
    } catch (e) { setAtt(prev); toast(friendlyError(e), 'error') }
    setMarking(null)
  }

  // Debounced authoritative refetch: browsers never predict queue positions themselves.
  const scheduleReload = useCallback(() => {
    window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(load, 250)
  }, [load])

  useEffect(() => {
    load()
    const channel = supabase.channel(`game:${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `game_id=eq.${gameId}` }, scheduleReload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, scheduleReload)
      .subscribe(status => {
        setLive(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') scheduleReload() // catch anything missed while reconnecting
      })
    const onVis = () => { if (document.visibilityState === 'visible') scheduleReload() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', scheduleReload)
    window.addEventListener('focus', scheduleReload)
    return () => {
      window.clearTimeout(reloadTimer.current)
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', scheduleReload)
      window.removeEventListener('focus', scheduleReload)
    }
  }, [gameId, load, scheduleReload])

  async function act(fn: () => Promise<unknown>, okText?: (r: unknown) => string) {
    setBusy(true)
    try { const r = await fn(); if (okText) toast(okText(r)) }
    catch (e) { toast(friendlyError(e), 'error') }
    await load()
    setBusy(false)
  }

  if (error && !data) return <div className="stack"><Notice tone="error">{error}</Notice>
    <div className="row"><button className="btn" onClick={load}>Try again</button><button className="btn btn-ghost" onClick={() => go({ name: 'home' })}>All games</button></div></div>
  if (!data) return <Spinner />

  const { game, group, me, roster, my_role } = data
  const tz = group.timezone
  const organiser = isOrganiser(my_role)
  const playing = roster.filter(r => r.status === 'playing')
  const waitlist = roster.filter(r => r.status === 'waitlist')
  const now = Date.now()
  const started = new Date(game.starts_at).getTime() <= now
  const ended = new Date(game.ends_at).getTime() <= now
  const canJoin = !me.status && game.status === 'open' && !ended && (!started || playing.length < game.capacity)
  const canWithdraw = !!me.status && !ended && game.status !== 'cancelled'
  const spotsLeft = Math.max(0, game.capacity - playing.length)
  const url = `${APP_URL}?game=${game.id}`
  const attOn = organiser && !!att && att.started && !att.cancelled
  const attBy = new Map((att?.rows ?? []).map(r => [r.user_id, r]))
  const playingIds = new Set(playing.map(p => p.user_id))
  // Players who were on the list at the start but have since withdrawn or been removed still need marking.
  const leftAfterStart = attOn ? att!.rows.filter(r => !playingIds.has(r.user_id)) : []
  const counts = { present: 0, no_show: 0, excused: 0, unmarked: 0 }
  for (const r of att?.rows ?? []) counts[r.status]++
  const attControls = (uid: string, name: string) => {
    const r = attBy.get(uid)
    if (!attOn || !r) return undefined
    return <AttendanceButtons status={r.status} ended={att!.ended} busy={marking === uid}
      name={name} onSet={st => markAttendance(uid, name, st)} />
  }

  const stateLabel = game.status === 'cancelled' ? 'Cancelled' : ended ? 'Finished' : started ? 'In progress'
    : game.status === 'closed' ? 'Registration closed' : 'Open for sign-ups'

  return (
    <article className="stack-lg game-page">
      <button className="link back" onClick={() => go({ name: 'home' })}>← All games</button>

      <header className="game-head">
        <span className={`badge badge-${game.status === 'open' && !started ? 'open' : game.status === 'cancelled' ? 'cancelled' : 'closed'}`}>{stateLabel}</span>
        <h1 className="display">{game.title}</h1>
        <dl className="facts">
          <div><dt>Date</dt><dd>{fmtDay(game.starts_at, tz)}</dd></div>
          <div><dt>Time</dt><dd>{fmtRange(game.starts_at, game.ends_at, tz)}</dd></div>
          {game.location && <div><dt>Where</dt><dd>{game.location}</dd></div>}
          <div><dt>Players</dt><dd>{playing.length} / {game.capacity}{waitlist.length ? ` · ${waitlist.length} waitlist` : ''}</dd></div>
        </dl>
        {game.notes && <p className="notes">{game.notes}</p>}
      </header>

      <section className={`me-card me-${me.status ?? 'none'}`} aria-live="polite">
        <div>
          <p className="me-label">Your status</p>
          <p className="me-status">
            {me.status === 'playing' ? <>You're playing — <b>#{me.position}</b></>
              : me.status === 'waitlist' ? <>Waitlist — <b>#{me.position}</b></>
              : 'Not signed up'}
          </p>
          <p className="small me-help">
            {me.status === 'waitlist' ? 'If someone withdraws, you move up automatically and we’ll email you.'
              : me.status === 'playing' ? 'Can’t make it? Withdraw so the next person on the waitlist gets your spot.'
              : canJoin ? (started ? `Game in progress — ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} still free. Join if you can get there.`
                : spotsLeft > 0 ? `${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left.` : 'Game is full — you’ll join the waitlist.')
              : started && !ended && game.status === 'open' ? 'Game in progress and full.'
              : game.status === 'cancelled' ? 'This game was cancelled.' : 'Sign-ups are closed.'}
          </p>
        </div>
        <div className="me-actions">
          {canJoin && <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => act(() => api.join(game.id), r => {
            const s = r as { status: string; position: number }
            return s.status === 'playing' ? `You're in — #${s.position}` : `You're on the waitlist — #${s.position}`
          })}>{busy ? 'Joining…' : started ? 'Join now' : spotsLeft > 0 ? 'Join game' : 'Join waitlist'}</button>}
          {canWithdraw && <ConfirmButton className="btn btn-danger-ghost" disabled={busy} confirmText="Tap again to withdraw"
            onConfirm={() => act(() => api.withdraw(game.id), () => 'You have withdrawn.')}>Withdraw</ConfirmButton>}
        </div>
      </section>

      <div className="lists">
        <section className="list-block">
          <h2>Playing <span className="count">{playing.length}/{game.capacity}</span></h2>
          {attOn && <div className="att-head">
            <p className="small att-summary" aria-live="polite">
              <b>{counts.present}</b> present · <b>{counts.no_show}</b> no-show · <b>{counts.excused}</b> excused · <b>{counts.unmarked}</b> unmarked
            </p>
            <p className="small muted att-legend">
              <span className="att-leg"><span className="att-key att-present"><IconCheck /></span>Present</span>
              <span className="att-leg"><span className="att-key att-excused"><IconExcused /></span>Excused</span>
              <span className="att-leg"><span className="att-key att-no_show"><IconX /></span>No-show{!att!.ended && ' (after game ends)'}</span>
              <span className="att-leg">Tap again to clear</span>
            </p>
          </div>}
          {playing.length === 0 ? <p className="muted">No one yet — be the first.</p> : (
            <ol className="roster">
              {playing.map(p => {
                const ctl = attControls(p.user_id, p.display_name)
                return <RosterRow key={p.user_id} n={p.position} name={p.display_name} userId={p.user_id} avatar={p.avatar_path} me={p.user_id === userId}
                  status={attOn ? attBy.get(p.user_id)?.status : undefined}
                  note={attOn && !ctl ? 'joined after start' : undefined}
                  controls={ctl}
                  onRemove={organiser && !started ? () => act(() => api.removeRegistration(game.id, p.user_id), () => `${p.display_name} removed.`) : undefined} />
              })}
            </ol>
          )}
          {leftAfterStart.length > 0 && <>
            <p className="small muted att-left-title">On the list at start, since withdrawn or removed</p>
            <ol className="roster roster-left">
              {leftAfterStart.map(r => <RosterRow key={r.user_id} n={0} name={r.name} userId={r.user_id} me={r.user_id === userId}
                status={r.status} controls={attControls(r.user_id, r.name)} />)}
            </ol>
          </>}
          {spotsLeft > 0 && playing.length > 0 && <p className="small muted open-spots">{spotsLeft} open {spotsLeft === 1 ? 'spot' : 'spots'}</p>}
        </section>
        <section className="list-block">
          <h2>Waitlist <span className="count">{waitlist.length}</span></h2>
          {waitlist.length === 0 ? <p className="muted">Nobody waiting.</p> : (
            <ol className="roster roster-wait">
              {waitlist.map(p => <RosterRow key={p.user_id} n={p.position} name={p.display_name} userId={p.user_id} avatar={p.avatar_path} me={p.user_id === userId}
                onRemove={organiser && !ended ? () => act(() => api.removeRegistration(game.id, p.user_id), () => `${p.display_name} removed.`) : undefined} />)}
            </ol>
          )}
        </section>
      </div>

      <section className="share card">
        <h2>Share in WhatsApp</h2>
        <div className="row wrap">
          <button className="btn" onClick={async () => toast(await copyText(url) ? 'Link copied.' : 'Could not copy — long-press the address bar instead.')}>Copy game link</button>
          <button className="btn" onClick={async () => toast(await copyText(shareMessage(data, url)) ? 'WhatsApp message copied.' : 'Could not copy.')}>Copy WhatsApp message</button>
          <a className="btn btn-whatsapp" href={`https://wa.me/?text=${encodeURIComponent(shareMessage(data, url))}`} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a>
        </div>
      </section>

      {my_role === 'admin' && game.status === 'cancelled' && (
        <section className="organiser card">
          <h2>Admin tools</h2>
          <p className="small muted">Deleting removes this cancelled game for everyone, including its sign-up history. This can't be undone.</p>
          <div className="row wrap">
            <ConfirmButton className="btn btn-danger-ghost" confirmText="Tap again to delete permanently" disabled={busy}
              onConfirm={async () => {
                setBusy(true)
                try { await api.deleteGame(game.id); toast(`“${game.title}” deleted.`); go({ name: 'home' }) }
                catch (e) { toast(friendlyError(e), 'error'); setBusy(false) }
              }}>Delete game</ConfirmButton>
          </div>
        </section>
      )}

      {organiser && game.status !== 'cancelled' && (
        <section className="organiser card">
          <h2>Organiser tools</h2>
          <div className="row wrap">
            <button className="btn" onClick={() => go({ name: 'edit-game', gameId: game.id })}>Edit game</button>
            {game.status === 'open'
              ? <button className="btn" disabled={busy} onClick={() => act(() => api.setStatus(game.id, 'closed'), () => 'Registration closed.')}>Close registration</button>
              : <button className="btn" disabled={busy} onClick={() => act(() => api.setStatus(game.id, 'open'), () => 'Registration reopened.')}>Reopen registration</button>}
            <ConfirmButton className="btn btn-danger-ghost" confirmText="Tap again to cancel game" disabled={busy}
              onConfirm={() => act(() => api.setStatus(game.id, 'cancelled'), () => 'Game cancelled.')}>Cancel game</ConfirmButton>
          </div>
          <p className="small muted">Closing stops new sign-ups but still lets players withdraw. Cancelling is permanent.</p>
        </section>
      )}

      <p className="small muted live">{live ? <><span className="dot" aria-hidden="true" /> Live — lists update automatically</> : 'Reconnecting… lists refresh when you return to this tab.'}</p>
    </article>
  )
}

function RosterRow({ n, name, userId, avatar, me, onRemove, controls, status, note }: {
  n: number; name: string; userId: string; avatar?: string | null; me: boolean; onRemove?: () => void
  controls?: ReactNode; status?: AttStatus; note?: string
}) {
  return (
    <li className={[me ? 'is-me' : '', status ? `att-row att-row-${status}` : ''].join(' ').trim()}>
      <span className="pos">{n > 0 ? n : '–'}</span>
      <Avatar userId={userId} name={name} path={avatar} size={32} />
      <span className="name">{name}{me && <span className="you">you</span>}
        {note && <span className="small muted att-note">{note}</span>}</span>
      {controls}
      {onRemove && <ConfirmButton className="btn btn-xs btn-ghost" confirmText="Remove?" onConfirm={onRemove}>Remove</ConfirmButton>}
    </li>
  )
}

function AttendanceButtons({ status, ended, busy, name, onSet }: {
  status: AttStatus; ended: boolean; busy: boolean; name: string; onSet: (s: AttStatus) => void
}) {
  const btn = (s: Exclude<AttStatus, 'unmarked'>, icon: ReactNode, disabled = false) => (
    <button type="button" className={`att-btn att-${s}${status === s ? ' is-on' : ''}`} aria-pressed={status === s}
      aria-label={`${attLabel[s]}: ${name}`} title={disabled ? 'No-show can be recorded after the game ends' : attLabel[s]}
      disabled={busy || disabled} onClick={() => onSet(status === s ? 'unmarked' : s)}>{icon}</button>
  )
  return <span className="att-btns" role="group" aria-label={`Attendance for ${name}`}>
    {btn('present', <IconCheck />)}
    {btn('excused', <IconExcused />)}
    {btn('no_show', <IconX />, !ended)}
  </span>
}

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
function IconCheck() { return <svg {...svg}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> }
function IconX() { return <svg {...svg}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg> }
function IconExcused() { return <svg {...svg}><circle cx="12" cy="12" r="8.5" /><path d="M8 12h8" /></svg> }
