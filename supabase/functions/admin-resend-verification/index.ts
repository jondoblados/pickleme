// FR-015: an admin asks PickleMe to resend the confirmation email to someone waiting to join their group.
// Deployed with verify_jwt = false (same as send-promotions): the admin's JWT is checked by PostgREST
// when we call claim_verification_resend as that admin. The email address is looked up here with the
// service role and is never returned to the browser.
import { createClient } from 'npm:@supabase/supabase-js@2'

const URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') ?? 'https://jon.doblados.net/pickleme/'
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://jon.doblados.net').split(',').map(s => s.trim())
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'invalid_request' })
  const auth = req.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S+/.test(auth)) return json(req, 401, { error: 'not_signed_in' })

  let groupId = '', userId = ''
  try { ({ group_id: groupId, user_id: userId } = await req.json()) } catch { /* fallthrough */ }
  if (!UUID.test(groupId ?? '') || !UUID.test(userId ?? '')) return json(req, 400, { error: 'invalid_request' })

  // 1. Authorise and rate-limit as the calling admin (the database enforces both, and writes the audit entry).
  const asCaller = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: claim, error: claimError } = await asCaller.rpc('claim_verification_resend',
    { p_group_id: groupId, p_user_id: userId })
  if (claimError) {
    const code = claimError.message
    const status = code === 'forbidden' ? 403 : code === 'resend_too_soon' ? 429 : code === 'pending_signup_not_found' ? 404
      : /jwt|not_signed_in/i.test(code) ? 401 : 400
    return json(req, status, { error: ['forbidden', 'resend_too_soon', 'pending_signup_not_found', 'not_signed_in'].includes(code) ? code : 'invalid_request' })
  }

  // 2. Look up the address server-side.
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
  const { data: found, error: lookupError } = await admin.auth.admin.getUserById(userId)
  if (lookupError || !found?.user?.email) return json(req, 404, { error: 'pending_signup_not_found' })
  if (found.user.email_confirmed_at) return json(req, 409, { error: 'already_confirmed' })

  // 3. Resend the Confirm signup email (code + link), leading back to the game or invite they came from.
  const params = new URLSearchParams({ from: 'email' })
  if (claim?.game_id) params.set('game', claim.game_id)
  else if (claim?.invite_token) params.set('invite', claim.invite_token)
  const pub = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: sendError } = await pub.auth.resend({
    type: 'signup', email: found.user.email, options: { emailRedirectTo: `${APP_URL}?${params}` },
  })
  if (sendError) {
    console.error('resend failed', sendError.status, sendError.code)
    return json(req, 502, { error: sendError.code === 'over_email_send_rate_limit' ? 'over_email_send_rate_limit' : 'send_failed' })
  }
  return json(req, 200, { sent: true })
})
