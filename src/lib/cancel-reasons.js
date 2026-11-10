// FR-019: pulldown options for cancelling a game. Codes match the database check constraint.
export const CANCEL_REASONS = Object.freeze([
  { code: 'rain', label: 'Rain / wet courts', text: 'Rain / wet courts.' },
  { code: 'lightning', label: 'Lightning risk', text: 'Lightning risk — not safe to play outdoors.' },
  { code: 'venue', label: 'Venue unavailable', text: 'Venue unavailable.' },
  { code: 'players', label: 'Not enough players', text: 'Not enough players signed up.' },
  { code: 'organiser', label: 'Organiser unavailable', text: 'No organiser available to run the session.' },
  { code: 'other', label: 'Other (type a reason)', text: '' },
])
export const CANCEL_REASON_MIN = 3
export const CANCEL_REASON_MAX = 200

/** Trimmed reason, or an error message for the form. */
export function checkCancelReason(code, reason) {
  const text = String(reason ?? '').trim()
  if (!CANCEL_REASONS.some(r => r.code === code)) return { ok: false, error: 'Choose a reason.' }
  if (text.length < CANCEL_REASON_MIN) return { ok: false, error: 'Add a short note for players (at least 3 characters).' }
  if (text.length > CANCEL_REASON_MAX) return { ok: false, error: `Keep it to ${CANCEL_REASON_MAX} characters.` }
  return { ok: true, text }
}

/** When the pulldown changes: replace the text if it is empty or still a previous preset; keep custom text. */
export function presetText(nextCode, currentText) {
  const current = String(currentText ?? '').trim()
  const isPreset = current === '' || CANCEL_REASONS.some(r => r.text && r.text === current)
  if (!isPreset) return currentText
  return CANCEL_REASONS.find(r => r.code === nextCode)?.text ?? ''
}

const roleName = { admin: 'Admin', organiser: 'Organiser' }
/** "Jon (Admin)", "Jon", or "An organiser" when the author is unknown. */
export function cancelNoteAuthor(c) {
  const name = c?.note_by_name?.trim()
  const role = roleName[c?.note_by_role]
  if (name && role) return `${name} (${role})`
  return name || 'An organiser'
}

/** One-line WhatsApp/caption text. */
export function cancelNoteLine(c) {
  if (!c) return null
  return c.reason ? `Note from ${cancelNoteAuthor(c)}: ${c.reason}` : null
}
