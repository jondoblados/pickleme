// FR-004 Promotion emails — Supabase Edge Function `send-promotions`.
// Called by the database (pg_net trigger + pg_cron sweep) with header `x-outbox-secret`.
// Claims due rows from notification_outbox, sends one email per promotion via Resend, records the outcome.
//
// Required secret (Supabase → Edge Functions → Secrets): RESEND_API_KEY
// Optional: PROMOTION_FROM (default "PickleMe <games@pickleme.doblados.net>"), APP_URL

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://bzxkbulljurizjrpixdm.supabase.co'
const API_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? 'sb_publishable_LDbiznUQVxLsta-B6H9icQ_7rbPou77'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM = Deno.env.get('PROMOTION_FROM') ?? 'PickleMe <games@pickleme.doblados.net>'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://jon.doblados.net/pickleme/'

interface Promotion {
  id: number; email: string; display_name: string; game_id: string; title: string
  starts_at: string; ends_at: string; location: string; notes: string; timezone: string
  group_name: string; position: number | null; attempt: number
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${fn} failed: ${res.status} ${text}`)
  return (text ? JSON.parse(text) : null) as T
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function fmt(p: Promotion) {
  const tz = p.timezone || 'Asia/Singapore'
  const day = new Intl.DateTimeFormat('en-SG', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(p.starts_at))
  const short = new Intl.DateTimeFormat('en-SG', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(p.starts_at))
  const t = (iso: string) => new Intl.DateTimeFormat('en-SG', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso)).replace(/\s/g, ' ').toLowerCase()
  return { day, short, start: t(p.starts_at), range: `${t(p.starts_at)} – ${t(p.ends_at)}` }
}

export function buildEmail(p: Promotion) {
  const f = fmt(p)
  const url = `${APP_URL}?game=${p.game_id}`
  const subject = `You're in: ${p.title} — ${f.short}, ${f.start}`
  const pos = p.position ? ` You're #${p.position} on the playing list.` : ''
  const text = [
    `Hi ${p.display_name},`,
    '',
    `Good news — a spot opened up and you've moved off the waitlist into ${p.title}.${pos}`,
    '',
    `Date: ${f.day}`,
    `Time: ${f.range}`,
    p.location ? `Location: ${p.location}` : null,
    '',
    `View the game: ${url}`,
    '',
    "Can't make it any more? Please withdraw on the game page so the next person on the waitlist gets the spot.",
    '',
    `— PickleMe · ${p.group_name}`,
  ].filter(l => l !== null).join('\n')

  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#5a675f;font-size:13px;text-transform:uppercase;letter-spacing:.06em">${k}</td><td style="padding:4px 0;font-weight:bold">${esc(v)}</td></tr>`
  const html = `<!doctype html><html><body style="margin:0;background:#f5f2ea">
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#15211b">
  <div style="background:#14382b;color:#ffffff;border-radius:14px;padding:22px 24px">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#cfe0d6">Off the waitlist</p>
    <h1 style="margin:0;font-size:24px;line-height:1.2">You're in, ${esc(p.display_name)}.</h1>
    <p style="margin:10px 0 0;color:#cfe0d6">A spot opened up for <strong style="color:#d9f24a">${esc(p.title)}</strong>.${p.position ? ` You're <strong style="color:#d9f24a">#${p.position}</strong> on the playing list.` : ''}</p>
  </div>
  <table style="margin:20px 0;border-collapse:collapse">${row('Date', f.day)}${row('Time', f.range)}${p.location ? row('Where', p.location) : ''}</table>
  <p style="margin:0 0 22px"><a href="${url}" style="background:#14382b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;display:inline-block">View the game</a></p>
  <p style="margin:0 0 8px;font-size:14px">Can't make it any more? Please withdraw on the game page so the next person on the waitlist gets the spot.</p>
  <p style="margin:16px 0 0;font-size:12px;color:#5a675f">PickleMe · ${esc(p.group_name)}. You're receiving this because you joined the waitlist for this game.</p>
</div></body></html>`
  return { subject, text, html }
}

async function send(p: Promotion): Promise<string> {
  const { subject, text, html } = buildEmail(p)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'content-type': 'application/json',
      'Idempotency-Key': `pickleme-promotion-${p.id}`, // retries never send twice
    },
    body: JSON.stringify({ from: FROM, to: [p.email], subject, text, html, tags: [{ name: 'type', value: 'promotion' }] }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`)
  return (JSON.parse(body) as { id?: string }).id ?? ''
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = req.headers.get('x-outbox-secret') ?? ''
  if (!secret) return new Response('Unauthorized', { status: 401 })

  let claimed: Promotion[]
  try {
    claimed = await rpc<Promotion[]>('claim_promotion_emails', { p_secret: secret, p_limit: 20 })
  } catch (e) {
    const msg = String(e)
    return new Response(JSON.stringify({ error: msg.includes('forbidden') ? 'forbidden' : 'claim_failed' }),
      { status: msg.includes('forbidden') ? 403 : 500, headers: { 'content-type': 'application/json' } })
  }

  if (!RESEND_API_KEY) {
    if (claimed.length) {
      await rpc('release_promotion_emails', { p_secret: secret, p_ids: claimed.map(c => c.id), p_reason: 'RESEND_API_KEY not configured' })
    }
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured', released: claimed.length }),
      { status: 503, headers: { 'content-type': 'application/json' } })
  }

  let sent = 0, failed = 0
  for (const p of claimed) {
    try {
      const id = await send(p)
      await rpc('complete_promotion_email', { p_secret: secret, p_id: p.id, p_ok: true, p_message_id: id })
      sent++
    } catch (e) {
      await rpc('complete_promotion_email', { p_secret: secret, p_id: p.id, p_ok: false, p_error: String(e) }).catch(() => {})
      failed++
    }
  }
  return new Response(JSON.stringify({ claimed: claimed.length, sent, failed }), { headers: { 'content-type': 'application/json' } })
})
