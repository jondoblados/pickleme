// FR-021: court booking fee helpers shared by the app, the roster image and tests. Amounts are integer cents (SGD).

export const FEE_MAX_CENTS = 999999

/** 4800 -> "SGD 48.00", 120000 -> "SGD 1,200.00". */
export function formatSgd(cents) {
  if (cents == null || !Number.isFinite(cents)) return ''
  const whole = Math.floor(Math.abs(cents) / 100).toLocaleString('en-SG')
  const part = String(Math.abs(cents) % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}SGD ${whole}.${part}`
}

/** Parses an organiser's input ("48", "48.5", "$1,200.00"). Blank -> null (no fee). Invalid -> NaN. */
export function parseSgd(text) {
  const s = String(text ?? '').replace(/sgd|s\$|\$|,|\s/gi, '')
  if (s === '') return null
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return NaN
  const [w, f = ''] = s.split('.')
  const cents = Number(w) * 100 + Number(f.padEnd(2, '0'))
  return cents >= 1 && cents <= FEE_MAX_CENTS ? cents : NaN
}

/** Ceiling division, so the shares never add up to less than the total. Null when nobody is playing. */
export function shareCents(totalCents, people) {
  if (totalCents == null || !people || people < 1) return null
  return Math.ceil(totalCents / people)
}

/** One-line cost summary for WhatsApp messages, the roster image and the games list. */
export function costLine(fee, { short = false } = {}) {
  if (!fee || fee.total_cents == null) return null
  const total = formatSgd(fee.total_cents)
  if (fee.final && fee.share_cents != null) {
    return short ? `${total} · ${formatSgd(fee.share_cents)} each (final)`
      : `Court fee: ${total} total · ${formatSgd(fee.share_cents)} each (final, ${fee.basis} paying)`
  }
  if (fee.share_cents == null) {
    return short ? `${total} · per player shown after sign-ups`
      : `Court fee: ${total} total · split between players${fee.share_if_full_cents != null ? ` (${formatSgd(fee.share_if_full_cents)} each if all places fill)` : ''}`
  }
  return short ? `${total} · ≈ ${formatSgd(fee.share_cents)} each (${fee.basis} playing)`
    : `Court fee: ${total} total · about ${formatSgd(fee.share_cents)} each (${fee.basis} playing; changes with sign-ups)`
}

/** Country codes offered in the confirmation picker. +65 is the default. Any other code can be typed in full. */
export const COUNTRY_CODES = [
  { code: '+65', label: 'Singapore' }, { code: '+60', label: 'Malaysia' }, { code: '+62', label: 'Indonesia' },
  { code: '+63', label: 'Philippines' }, { code: '+66', label: 'Thailand' }, { code: '+84', label: 'Vietnam' },
  { code: '+91', label: 'India' }, { code: '+86', label: 'China' }, { code: '+852', label: 'Hong Kong' },
  { code: '+61', label: 'Australia' }, { code: '+44', label: 'United Kingdom' }, { code: '+1', label: 'US / Canada' },
]

/** Strips spaces, dots, dashes and brackets; a leading 00 becomes +. Mirrors private.normalize_mobile. */
export function normalizeMobile(text) {
  const s = String(text ?? '').replace(/[\s().-]/g, '')
  return s.startsWith('00') ? '+' + s.slice(2) : s
}

/**
 * Builds an international (E.164) number from the picker and the typed number.
 * If the typed number already starts with + or 00, the picker is ignored.
 * Returns { ok: true, mobile } or { ok: false, error }.
 */
export function buildMobile(countryCode, typed) {
  let n = normalizeMobile(typed)
  if (!n) return { ok: false, error: 'Enter your mobile number.' }
  if (!n.startsWith('+')) n = countryCode + n.replace(/^0+/, '')
  if (!/^\+[1-9]\d{7,14}$/.test(n)) return { ok: false, error: 'Enter a mobile number with its country code, as used in WhatsApp.' }
  return { ok: true, mobile: n }
}

/** PayNow payee numbers must be Singapore mobiles. Accepts "9123 4567" or "+65 9123 4567". */
export function checkPayNowMobile(text) {
  let n = normalizeMobile(text)
  if (/^[89]\d{7}$/.test(n)) n = '+65' + n
  return /^\+65[89]\d{7}$/.test(n) ? { ok: true, mobile: n }
    : { ok: false, error: 'Enter a Singapore mobile number registered for PayNow (8 digits starting with 8 or 9).' }
}

/** "+6591234567" -> "+65 9123 4567"; other countries are shown as code + number. */
export function formatMobile(mobile) {
  if (!mobile) return ''
  const sg = /^\+65(\d{4})(\d{4})$/.exec(mobile)
  if (sg) return `+65 ${sg[1]} ${sg[2]}`
  const cc = COUNTRY_CODES.map(c => c.code).sort((a, b) => b.length - a.length).find(c => mobile.startsWith(c))
  if (!cc) return mobile
  const rest = mobile.slice(cc.length)
  if (rest.length <= 6) return `${cc} ${rest}`
  const head = rest.slice(0, -4).match(/.{1,3}/g).join(' ')
  return `${cc} ${head} ${rest.slice(-4)}`
}

/** Hours, not days, so the result matches the database regardless of daylight saving. */
export function visibleFrom(visibility, startsAtIso) {
  const h = visibility === 'week_before' ? 168 : visibility === 'two_weeks_before' ? 336 : 0
  if (!h || !startsAtIso) return null
  return new Date(new Date(startsAtIso).getTime() - h * 3600_000).toISOString()
}
