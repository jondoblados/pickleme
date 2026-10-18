import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { safeNext } from '../lib/route'
import { Notice } from '../components/ui'
import { Wordmark } from '../components/Wordmark'

/**
 * Landing page for the custom email template:
 *   {{ .RedirectTo }}&auth=confirm&token_hash={{ .TokenHash }}&type=email
 * The token is only consumed when the player taps "Continue", so email link scanners
 * that pre-fetch URLs cannot use up the link.
 */
export function AuthConfirm({ search, onDone }: { search: string; onDone: (next: string) => void }) {
  const q = new URLSearchParams(search)
  const tokenHash = q.get('token_hash')
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
      <div className="signin-hero"><Wordmark /><h1 className="display">Almost there.</h1></div>
      <div className="card signin-card stack">
        <h2>Continue signing in</h2>
        <p>Tap below to finish signing in on this device.</p>
        {error && <Notice tone="error">{error}</Notice>}
        {tokenHash && !error && <button className="btn btn-primary btn-lg" onClick={confirm} disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>}
        {error && <button className="btn" onClick={() => onDone(safeNext(search))}>Request a new link</button>}
      </div>
    </div>
  )
}
