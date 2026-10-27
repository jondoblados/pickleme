// Helpers for the email sign-in code (FR-014). Plain JS so node --test can import it directly.
export const CODE_MIN = 6
export const CODE_MAX = 10 // Supabase allows 6–10 digit email codes; PickleMe is configured for 6.
export const PENDING_KEY = 'pm:code-sent'
export const PENDING_TTL_MS = 60 * 60 * 1000 // codes expire after an hour

/** Keep digits only, so pasted codes like "123 456" or "123-456" work. */
export function normaliseCode(input) {
  return String(input ?? '').replace(/\D/g, '').slice(0, CODE_MAX)
}

export function isCompleteCode(code) {
  return /^\d+$/.test(code) && code.length >= CODE_MIN && code.length <= CODE_MAX
}

/** Read the "code sent" marker; returns the email or null when missing, malformed or expired. */
export function readPending(raw, now = Date.now()) {
  try {
    const v = JSON.parse(raw ?? '')
    if (!v || typeof v.email !== 'string' || typeof v.at !== 'number') return null
    if (now - v.at < 0 || now - v.at > PENDING_TTL_MS) return null
    return v.email
  } catch { return null }
}

export function writePending(email, now = Date.now()) {
  return JSON.stringify({ email, at: now })
}
