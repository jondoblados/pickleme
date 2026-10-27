export const activityLabels = Object.freeze({
  joined: 'Joined game', joined_late: 'Joined game late', withdrew: 'Withdrew', removed: 'Removed player',
  game_created: 'Created game', game_updated: 'Edited game', status_open: 'Opened registration',
  status_closed: 'Closed registration', status_cancelled: 'Cancelled game', game_deleted: 'Deleted game',
  member_joined: 'Joined group', member_joined_via_game: 'Joined group from game',
  role_changed: 'Changed role', attendance_changed: 'Changed attendance', promoted: 'Waitlist promotion',
  invite_created: 'Created invite', invite_revoked: 'Revoked invite', group_renamed: 'Renamed group',
  verification_resent: 'Resent confirmation email', pending_signup_dismissed: 'Dismissed unconfirmed sign-up'
})
export function activityLabel(action) { return activityLabels[action] ?? action }
/** Affected player: snapshot name, else the masked email recorded for unconfirmed sign-ups. */
export function activityTarget(row) {
  if (row.target_name) return row.target_name_origin === 'repaired_current_profile' ? `${row.target_name} (current name)` : row.target_name
  return row.details?.masked_email ?? (row.target_user_id ? 'Unknown player' : null)
}
/** Who did it: a person acting on themselves, a person acting on someone else, or the system. */
export function activityActorKind(row) {
  if (row.actor_kind) return row.actor_kind
  if (!row.actor_id && !row.actor_name) return 'system'
  return row.actor_id && row.actor_id === row.target_user_id ? 'self' : 'member'
}
export function activityActor(row) {
  const kind = activityActorKind(row)
  if (kind === 'system') return row.triggered_by_name ? `System (triggered by ${row.triggered_by_name})` : 'System'
  const notes = []
  if (kind === 'self') notes.push('self')
  if (row.actor_name && row.actor_name_origin === 'repaired_current_profile') notes.push('current name')
  const name = row.actor_name ?? 'Name not set'
  return notes.length ? `${name} (${notes.join(', ')})` : name
}
export function activityChanges(details) {
  return Object.entries(details?.changes ?? {}).map(([field, value]) => ({
    field, before: value.before ?? null, after: value.after ?? null
  }))
}
export function activityCsv(rows) {
  const cell = value => {
    let s = String(value ?? '')
    if (/^\s*[=+@-]|^[\t\r\n]/.test(s)) s = "'" + s
    return '"' + s.replace(/"/g, '""') + '"'
  }
  const headers = ['Event ID','Date/time (UTC)','Performed by','Action','Affected player','Game','Game ID','Context origin','Details']
  const data = rows.map(r => [r.id,r.created_at,activityActor(r),activityLabel(r.action),
    activityTarget(r),r.game_title ?? 'Unknown game',r.game_id,r.context_origin,JSON.stringify(r.details ?? {})])
  return '\ufeff' + [headers,...data].map(row => row.map(cell).join(',')).join('\r\n')
}
