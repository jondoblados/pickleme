// Display and edit times in the group's timezone (Asia/Singapore initially); store UTC.

export function fmtDay(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-SG', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))
}
export function fmtShortDay(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-SG', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso))
}
export function fmtTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-SG', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso)).replace(/\s/g, ' ').toLowerCase()
}
export function fmtRange(start: string, end: string, tz: string) {
  return `${fmtTime(start, tz)} – ${fmtTime(end, tz)}`
}

function parts(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d)
  const get = (t: string) => Number(p.find(x => x.type === t)?.value)
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') }
}
function offsetMs(d: Date, tz: string) {
  const x = parts(d, tz)
  return Date.UTC(x.y, x.m - 1, x.d, x.h, x.mi, x.s) - Math.floor(d.getTime() / 1000) * 1000
}

/** "2026-10-20T19:00" interpreted in tz -> ISO UTC string */
export function localInputToIso(value: string, tz: string): string {
  const [date, time] = value.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  let ts = guess - offsetMs(new Date(guess), tz)
  ts = guess - offsetMs(new Date(ts), tz)
  return new Date(ts).toISOString()
}

/** ISO -> "YYYY-MM-DDTHH:mm" in tz for <input type="datetime-local"> */
export function isoToLocalInput(iso: string, tz: string): string {
  const x = parts(new Date(iso), tz)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${x.y}-${pad(x.m)}-${pad(x.d)}T${pad(x.h)}:${pad(x.mi)}`
}

/** Next given weekday (0=Sun) at hh:mm in tz, as datetime-local value */
export function nextWeekdayAt(weekday: number, hh: number, mm: number, tz: string): string {
  const now = new Date()
  const today = parts(now, tz)
  const todayDow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay()
  let add = (weekday - todayDow + 7) % 7
  if (add === 0 && (today.h > hh || (today.h === hh && today.mi >= mm))) add = 7
  const dt = new Date(Date.UTC(today.y, today.m - 1, today.d + add))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(hh)}:${pad(mm)}`
}

export function addDaysLocal(value: string, days: number): string {
  const [date, time] = value.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${time}`
}
