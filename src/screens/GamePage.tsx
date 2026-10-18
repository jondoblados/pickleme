import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, APP_URL } from '../lib/supabase'
import { api, isOrganiser, type GameDetail } from '../lib/api'
import { friendlyError } from '../lib/errors'
import type { Route } from '../lib/route'
import { fmtDay, fmtRange } from '../lib/time'
import { copyText } from '../lib/clipboard'
import { ConfirmButton, Notice, Spinner, useToast } from '../components/ui'

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

export function GamePage({ gameId, userId, go }: { gameId: string; userId: string; go: (r: Route) => void }) {
  const toast = useToast()
  const [data, setData] = useState<GameDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)
  const reloadTimer = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    try { setData(await api.getGame(gameId)); setError(null) } catch (e) { setError(friendlyError(e)) }
  }, [gameId])

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
  const canJoin = !me.status && game.status === 'open' && !started
  const canWithdraw = !!me.status && !ended && game.status !== 'cancelled'
  const spotsLeft = Math.max(0, game.capacity - playing.length)
  const url = `${APP_URL}?game=${game.id}`

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
            {me.status === 'waitlist' ? 'If someone withdraws, you move up automatically.'
              : me.status === 'playing' ? 'Can’t make it? Withdraw so the next person on the waitlist gets your spot.'
              : canJoin ? (spotsLeft > 0 ? `${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left.` : 'Game is full — you’ll join the waitlist.')
              : game.status === 'cancelled' ? 'This game was cancelled.' : 'Sign-ups are closed.'}
          </p>
        </div>
        <div className="me-actions">
          {canJoin && <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => act(() => api.join(game.id), r => {
            const s = r as { status: string; position: number }
            return s.status === 'playing' ? `You're in — #${s.position}` : `You're on the waitlist — #${s.position}`
          })}>{busy ? 'Joining…' : spotsLeft > 0 ? 'Join game' : 'Join waitlist'}</button>}
          {canWithdraw && <ConfirmButton className="btn btn-danger-ghost" disabled={busy} confirmText="Tap again to withdraw"
            onConfirm={() => act(() => api.withdraw(game.id), () => 'You have withdrawn.')}>Withdraw</ConfirmButton>}
        </div>
      </section>

      <div className="lists">
        <section className="list-block">
          <h2>Playing <span className="count">{playing.length}/{game.capacity}</span></h2>
          {playing.length === 0 ? <p className="muted">No one yet — be the first.</p> : (
            <ol className="roster">
              {playing.map(p => <RosterRow key={p.user_id} n={p.position} name={p.display_name} me={p.user_id === userId}
                onRemove={organiser && !ended ? () => act(() => api.removeRegistration(game.id, p.user_id), () => `${p.display_name} removed.`) : undefined} />)}
            </ol>
          )}
          {spotsLeft > 0 && playing.length > 0 && <p className="small muted open-spots">{spotsLeft} open {spotsLeft === 1 ? 'spot' : 'spots'}</p>}
        </section>
        <section className="list-block">
          <h2>Waitlist <span className="count">{waitlist.length}</span></h2>
          {waitlist.length === 0 ? <p className="muted">Nobody waiting.</p> : (
            <ol className="roster roster-wait">
              {waitlist.map(p => <RosterRow key={p.user_id} n={p.position} name={p.display_name} me={p.user_id === userId}
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

function RosterRow({ n, name, me, onRemove }: { n: number; name: string; me: boolean; onRemove?: () => void }) {
  return (
    <li className={me ? 'is-me' : ''}>
      <span className="pos">{n}</span>
      <span className="name">{name}{me && <span className="you">you</span>}</span>
      {onRemove && <ConfirmButton className="btn btn-xs btn-ghost" confirmText="Remove?" onConfirm={onRemove}>Remove</ConfirmButton>}
    </li>
  )
}
