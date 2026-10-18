import { useCallback, useEffect, useState } from 'react'
import { api, isOrganiser, type GameSummary, type Me } from '../lib/api'
import { friendlyError } from '../lib/errors'
import type { Route } from '../lib/route'
import { fmtRange, fmtShortDay } from '../lib/time'
import { Notice } from '../components/ui'
import { StatusChip } from '../components/StatusChip'

export function Home({ group, go }: { group: Me['groups'][number]; go: (r: Route) => void }) {
  const [past, setPast] = useState(false)
  const [games, setGames] = useState<GameSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const g = await api.listGames(past); setGames(past ? g.reverse() : g); setError(null) }
    catch (e) { setError(friendlyError(e)) }
  }, [past])

  useEffect(() => { setGames(null); load() }, [load])
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [load])

  return (
    <section className="stack-lg">
      <div className="section-head">
        <div>
          <h1 className="display">{past ? 'Past games' : 'Upcoming games'}</h1>
          <p className="muted">{group.name}</p>
        </div>
        {isOrganiser(group.role) && !past && <button className="btn btn-primary" onClick={() => go({ name: 'new-game' })}>New game</button>}
      </div>

      {error && <Notice tone="error">{error} <button className="link" onClick={load}>Retry</button></Notice>}
      {!games && !error && <div className="skeleton-list">{[0, 1, 2].map(i => <div key={i} className="skeleton-card" />)}</div>}
      {games && games.length === 0 && (
        <div className="empty card">
          <h2>{past ? 'No past games yet' : 'No games scheduled'}</h2>
          <p className="muted">{past ? 'Games from the last 60 days will appear here.'
            : isOrganiser(group.role) ? 'Create the next game, then share its link in WhatsApp.' : 'When an organiser posts the next game, it will show up here.'}</p>
        </div>
      )}
      {games && games.length > 0 && (
        <ul className="game-list">
          {games.map(g => {
            const full = g.playing >= g.capacity
            return (
              <li key={g.id}>
                <button className="game-card" onClick={() => go({ name: 'game', gameId: g.id })}>
                  <div className="game-card-date">
                    <span className="day">{fmtShortDay(g.starts_at, g.timezone)}</span>
                    <span className="time">{fmtRange(g.starts_at, g.ends_at, g.timezone)}</span>
                  </div>
                  <div className="game-card-body">
                    <strong className="title">{g.title}</strong>
                    {g.location && <span className="muted">{g.location}</span>}
                    <div className="meter" aria-label={`${g.playing} of ${g.capacity} places taken`}>
                      <span style={{ width: `${Math.min(100, (g.playing / g.capacity) * 100)}%` }} />
                    </div>
                    <span className="small">
                      {g.playing}/{g.capacity} playing{g.waitlist > 0 ? ` · ${g.waitlist} waitlist` : full ? ' · full' : ` · ${g.capacity - g.playing} spots left`}
                    </span>
                  </div>
                  <div className="game-card-status">
                    {g.status !== 'open' ? <span className={`badge badge-${g.status}`}>{g.status === 'closed' ? 'Closed' : 'Cancelled'}</span>
                      : <StatusChip me={g.me} />}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <button className="link center-self" onClick={() => setPast(p => !p)}>{past ? 'Show upcoming games' : 'Show past games'}</button>
    </section>
  )
}
