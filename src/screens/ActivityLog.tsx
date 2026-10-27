import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Me } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { activityLabels, activityLabel, activityChanges, activityCsv, type ActivityCursor, type ActivityEvent, type ActivityPage, activityTarget, activityActor, activityActorKind } from '../lib/activity-log.js'
import { getActivityChoices, getActivityPage, type ActivityChoices, type ActivityFilters } from '../lib/activity-api'
import { Notice, Spinner } from '../components/ui'
import './ActivityLog.css'
import { Avatar } from '../components/Avatar'

type Group = Me['groups'][number]
function localDate(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (key: string) => parts.find(p => p.type === key)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
function defaults(tz: string): ActivityFilters {
  return { from: localDate(new Date(Date.now() - 30 * 86400000), tz), to: localDate(new Date(), tz), game: '', person: '', action: '' }
}
function valid(filters: ActivityFilters) {
  const span = (Date.parse(filters.to) - Date.parse(filters.from)) / 86400000
  return Number.isFinite(span) && span >= 0 && span <= 365
}
function show(value: unknown, tz: string, field = ''): string {
  if (value === null || value === undefined) return '—'
  if (value === '') return '(empty)'
  if ((field === 'starts_at' || field === 'ends_at') && typeof value === 'string') return stamp(value, tz)
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
function stamp(iso: string, tz: string) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-SG', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date)
}
const fields: Record<string, string> = { title: 'Title', starts_at: 'Start time', ends_at: 'End time', location: 'Location', capacity: 'Capacity', notes: 'Notes' }
function saveCsv(rows: ActivityEvent[]) {
  const blob = new Blob([activityCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = 'pickleme-activity-log.csv'; document.body.append(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function ActivityLog({ group }: { group: Group }) {
  if (group.role !== 'admin') return <Notice tone="error">Only admins of this group can view the activity log.</Notice>
  return <ActivityLogContent key={group.id} group={group} />
}
function ActivityLogContent({ group }: { group: Group }) {
  const [draft, setDraft] = useState(() => defaults(group.timezone))
  const [applied, setApplied] = useState<ActivityFilters | null>(null)
  const [choices, setChoices] = useState<ActivityChoices>({ games: [], people: [] })
  const [page, setPage] = useState<ActivityPage | null>(null)
  const [cursors, setCursors] = useState<(ActivityCursor | null)[]>([null])
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const sequence = useRef(0), exportSequence = useRef(0)
  useEffect(() => {
    void load(defaults(group.timezone), null, null, [null], 0, true)
    return () => { sequence.current++; exportSequence.current++ }
    // Group-keyed content remounts when the selected group changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function load(filters: ActivityFilters, cursor: ActivityCursor | null, asOf: string | null, history: (ActivityCursor | null)[], nextIndex: number, refreshChoices = false) {
    if (!valid(filters)) { setError('Choose an inclusive date range of no more than 366 days.'); return }
    const request = ++sequence.current
    setBusy(true); setError(''); setPage(null); setExpanded(null)
    if (refreshChoices) setChoices({ games: [], people: [] })
    try {
      const [result, options] = await Promise.all([
        getActivityPage(group.id, filters, cursor, asOf),
        refreshChoices ? getActivityChoices(group.id, filters.from, filters.to) : Promise.resolve(null),
      ])
      if (request !== sequence.current) return
      setPage(result); setApplied({ ...filters }); setCursors(history); setIndex(nextIndex)
      if (options) setChoices(options)
    } catch (e) {
      if (request === sequence.current) { setError(friendlyError(e)); setChoices({ games: [], people: [] }) }
    } finally { if (request === sequence.current) setBusy(false) }
  }
  function apply(e: FormEvent) { e.preventDefault(); void load(draft, null, null, [null], 0, true) }
  function reset() { const filters = defaults(group.timezone); setDraft(filters); void load(filters, null, null, [null], 0, true) }
  function change(key: keyof ActivityFilters, value: string) {
    setDraft(old => ({ ...old, ...(key === 'from' || key === 'to' ? { game: '', person: '' } : {}), [key]: value }))
  }
  async function exportAll() {
    if (!applied || !page) return
    const request = ++exportSequence.current, filters = { ...applied }, asOf = page.as_of
    setExporting(true); setError(''); setProgress(0)
    let cursor: ActivityCursor | null = null
    const rows: ActivityEvent[] = [], seen = new Set<string>()
    try {
      for (let i = 0; i < 500; i++) {
        const result = await getActivityPage(group.id, filters, cursor, asOf, 100)
        if (request !== exportSequence.current) return
        rows.push(...result.rows); setProgress(rows.length)
        if (!result.next_cursor) { saveCsv(rows); return }
        const key = `${result.next_cursor.at}/${result.next_cursor.id}`
        if (seen.has(key)) throw new Error('Export pagination repeated. No file was saved; please retry.')
        seen.add(key); cursor = result.next_cursor
      }
      throw new Error('Too many records for one export. Narrow the date range; no partial file was saved.')
    } catch (e) {
      if (request === exportSequence.current) { setError(friendlyError(e)); setPage(null); setChoices({ games: [], people: [] }) }
    } finally { if (request === exportSequence.current) setExporting(false) }
  }
  function cancelExport() { exportSequence.current++; setExporting(false); setProgress(0) }
  const dirty = !!applied && JSON.stringify(draft) !== JSON.stringify(applied)
  const disabled = busy || exporting
  return <section className="stack-lg activity-log">
    <header><div className="row wrap"><h1 className="display">Activity log</h1><span className="badge">Admins only</span></div>
      <p>Track player sign-ups and organiser changes in {group.name}.</p></header>
    <Notice>Read-only history. Older entries may have incomplete details and names backfilled from current profiles. Deleted history from before this feature cannot be recovered.</Notice>
    <form className="card activity-filters" onSubmit={apply}>
      <label className="field"><span>From</span><input type="date" required value={draft.from} disabled={disabled} onChange={e => change('from', e.target.value)} /></label>
      <label className="field"><span>Through</span><input type="date" required value={draft.to} disabled={disabled} onChange={e => change('to', e.target.value)} /></label>
      <label className="field"><span>Game</span><select value={draft.game} disabled={disabled} onChange={e => change('game', e.target.value)}>
        <option value="">All games</option>{choices.games.map(g => <option key={g.id} value={g.id}>{g.name} · {g.id.slice(-6)}</option>)}
      </select></label>
      <label className="field"><span>Person (actor or affected)</span><select value={draft.person} disabled={disabled} onChange={e => change('person', e.target.value)}>
        <option value="">All people</option>{choices.people.map(p => <option key={p.id} value={p.id}>{p.name} · {p.id.slice(-6)}</option>)}
      </select></label>
      <label className="field"><span>Action</span><select value={draft.action} disabled={disabled} onChange={e => change('action', e.target.value)}>
        <option value="">All actions</option>{Object.entries(activityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <div className="row wrap"><button className="btn btn-primary" disabled={disabled || !valid(draft)}>Apply filters</button>
        <button type="button" className="btn btn-ghost" disabled={disabled} onClick={reset}>Reset</button></div>
      <p className="small muted activity-filter-note">Dates and event times use {group.timezone}. Apply a new date range to refresh game/person choices.</p>
    </form>
    {dirty && <p className="small muted">Filters have changed. Apply them to update the results; export uses the currently applied filters.</p>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="card stack">
      <div className="row wrap activity-toolbar"><p aria-live="polite">{page ? `${page.rows.length ? `Records ${index * 50 + 1}–${index * 50 + page.rows.length}` : 'No events'} · Page ${index + 1}` : busy ? 'Loading activity…' : 'No results loaded'}</p>
        <button className="btn" disabled={disabled || !page} onClick={exportAll}>Export filtered CSV</button>
        <button className="btn btn-ghost" disabled={disabled} onClick={() => applied && void load(applied, null, null, [null], 0, true)}>Refresh</button></div>
      {exporting && <div className="row"><p role="status">Preparing export: {progress} records…</p><button className="btn btn-ghost" onClick={cancelExport}>Cancel export</button></div>}
      {busy && <Spinner />}
      {page && <><div className="activity-table-wrap"><table className="activity-table">
        <caption className="small muted">Newest first · {page.timezone}</caption>
        <thead><tr><th>Date &amp; time</th><th>Performed by</th><th>Action</th><th>Affected player</th><th>Game</th><th>Details</th></tr></thead>
        <tbody>{page.rows.map(row => <Fragment key={row.id}>
          <tr><td>{stamp(row.created_at, group.timezone)}</td><td><span className="activity-person">{activityActorKind(row) !== 'system' && <Avatar userId={row.actor_id} name={row.actor_name} path={row.actor_avatar_path} size={24} />}{activityActor(row)}</span></td>
            <td><span className={`activity-action activity-${row.action.startsWith('status_cancelled') || row.action === 'removed' ? 'warning' : 'neutral'}`}>{activityLabel(row.action)}</span></td>
            <td>{activityTarget(row) ? <span className="activity-person">{row.target_user_id && <Avatar userId={row.target_user_id} name={row.target_name} path={row.target_avatar_path} size={24} />}{activityTarget(row)}</span> : '—'}</td>
            <td>{row.game_title ?? (row.game_id ? 'Unknown game' : 'Group activity')}{row.game_starts_at && <span className="small muted activity-sub">{stamp(row.game_starts_at, group.timezone)}</span>}</td>
            <td><button className="btn btn-sm btn-ghost" aria-expanded={expanded === row.id} aria-controls={`event-${row.id}`} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? 'Hide' : 'View details'}</button>
              {row.context_origin === 'backfilled_current' && <span className="small muted activity-sub">Legacy context</span>}</td></tr>
          {expanded === row.id && <tr id={`event-${row.id}`} className="activity-expanded"><td colSpan={6}>
            {activityChanges(row.details).length ? <dl className="activity-changes">{activityChanges(row.details).map(c => <div key={c.field}>
              <dt>{fields[c.field] ?? c.field}</dt><dd><span>Before: {show(c.before, group.timezone, c.field)}</span><span>After: {show(c.after, group.timezone, c.field)}</span></dd>
            </div>)}</dl> : <p>{Object.keys(row.details).length ? JSON.stringify(row.details) : 'No additional details were recorded for this event.'}</p>}
            <p className="small muted">Event {row.id} · {row.context_origin === 'backfilled_current' ? 'Identity and game context backfilled; exact historical values may be unavailable.' : 'Context captured when this event was recorded.'}</p>
          </td></tr>}
        </Fragment>)}</tbody>
      </table></div>
      {!page.rows.length && <p className="muted">No activity matches the applied filters.</p>}
      <div className="row wrap"><button className="btn" disabled={disabled || index === 0} onClick={() => applied && void load(applied, cursors[index - 1], page.as_of, cursors, index - 1)}>Previous</button>
        <span>Page {index + 1}</span><button className="btn" disabled={disabled || !page.next_cursor} onClick={() => {
          if (applied && page.next_cursor) void load(applied, page.next_cursor, page.as_of, [...cursors.slice(0, index + 1), page.next_cursor], index + 1)
        }}>Next</button></div></>}
    </div>
    <p className="small muted">Only admins of this group can view or export this log. The app cannot edit or delete individual events.</p>
  </section>
}
