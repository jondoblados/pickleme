// FR-016: weekly removal of profile photos no profile references (replaced photos the browser failed to
// delete, and photos of deleted accounts). Called by pg_cron through private.kick_avatar_cleanup with the
// shared `x-outbox-secret` header. Deployed with verify_jwt = false; the secret is checked by the database.
// Files are removed through the Storage API because direct SQL deletes on storage.objects are blocked.
import { createClient } from 'npm:@supabase/supabase-js@2'

const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'invalid_request' })
  const secret = req.headers.get('x-outbox-secret') ?? ''
  if (!secret) return json(401, { error: 'forbidden' })
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
  let removed = 0
  for (let round = 0; round < 10; round++) {
    const { data, error } = await admin.rpc('claim_avatar_orphans', { p_secret: secret, p_limit: 500 })
    if (error) return json(error.code === '42501' ? 401 : 500, { error: error.code === '42501' ? 'forbidden' : 'list_failed' })
    const names = (data ?? []) as string[]
    if (!names.length) break
    for (let i = 0; i < names.length; i += 100) {
      const { error: rmError } = await admin.storage.from('avatars').remove(names.slice(i, i + 100))
      if (rmError) return json(500, { error: 'remove_failed', removed })
      removed += Math.min(100, names.length - i)
    }
    if (names.length < 500) break
  }
  console.log(JSON.stringify({ event: 'avatar_cleanup', removed }))
  return json(200, { removed })
})
