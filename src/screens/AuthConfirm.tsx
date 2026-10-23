import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { safeNext } from '../lib/route'
import { Notice } from '../components/ui'
import { Wordmark } from '../components/Wordmark'

/**
 * Landing page for the custom email templates (Magic Link and Confirm signup):
 *   {{ .RedirectTo }}&auth=confirm[&flow=signup]&token_hash={{ .TokenHash }}&type=email
 * The email link points at PickleMe; this page then verifies the token with Supabase.
 * The token is only consumed when the player taps "Continue", so email link scanners
 * that pre-fetch URLs cannot use up the link.
 */
export function AuthConfirm({ search, onDone }: { search: string; onDone: (next: string) => void }) {
  const q = new URLSearchParams(search)
  const tokenHash = q.get('token_hash')
  const signup = q.get('flow') === 'signup'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(tokenHash ? null : 'This sign-in link is incomplete.')

  async function confirm() {
    if (!tokenHash) return
    setBusy(true); setError(null)
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
    setBusy(false)
    if (error) { setError(friendlyError(error)); return }
    onDone(safeNext(search)) // strips token_hash from the address bar
  }

  return (
    <div className="signin">
      <div className="signin-hero"><Wordmark /><h1 className="display">{signup ? 'Welcome.' : 'Almost there.'}</h1></div>
      <div className="card signin-card stack">
        <h2>{signup ? 'Confirm your email' : 'Continue signing in'}</h2>
        <p>{signup ? 'Tap below to confirm your email and finish creating your PickleMe account on this device.' : 'Tap below to finish signing in on this device.'}</p>
        {error && <Notice tone="error">{error}</Notice>}
        {tokenHash && !error && <button className="btn btn-primary btn-lg" onClick={confirm} disabled={busy}>{busy ? (signup ? 'Confirming…' : 'Signing in…') : (signup ? 'Confirm email & continue' : 'Continue')}</button>}
        {error && <button className="btn" onClick={() => onDone(safeNext(search))}>Request a new link</button>}
      </div>
    </div>
  )
}
