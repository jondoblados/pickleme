import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase, APP_URL } from '../lib/supabase'
import { friendlyError, DELETED_ACCOUNT_FLAG } from '../lib/errors'
import { safeNext } from '../lib/route'
import { Notice } from '../components/ui'
import { Wordmark } from '../components/Wordmark'
import { normaliseCode, isCompleteCode, readPending, writePending, PENDING_KEY, CODE_MAX } from '../lib/otp.js'

function loadPending(): string | null {
  try { return readPending(localStorage.getItem(PENDING_KEY)) } catch { return null }
}
function savePending(email: string | null) {
  try { if (email) localStorage.setItem(PENDING_KEY, writePending(email)); else localStorage.removeItem(PENDING_KEY) } catch { /* private mode */ }
}

const COOLDOWN = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function pendingContext(q: URLSearchParams): Promise<Record<string, string>> {
  const game = q.get('game'); const invite = q.get('invite')
  if (game && UUID.test(game)) return { pm_pending_game: game.toLowerCase() }
  if (invite && crypto?.subtle) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(invite))
      return { pm_pending_invite_hash: [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('') }
    } catch { /* not a secure context */ }
  }
  return {}
}

export function SignIn({ search, initialError, footer }: { search: string; initialError: string | null; footer?: ReactNode }) {
  const [email, setEmail] = useState(() => localStorage.getItem('pm:last-email') ?? '')
  // Remember that a code was sent, so returning from the mail app (or a reload) still shows the code box.
  const [sentTo, setSentTo] = useState<string | null>(loadPending)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(() => {
    try {
      if (sessionStorage.getItem(DELETED_ACCOUNT_FLAG)) {
        sessionStorage.removeItem(DELETED_ACCOUNT_FLAG)
        return 'Your previous sign-in was for an account that no longer exists. Enter your email to sign in again.'
      }
    } catch { /* private mode */ }
    return initialError
  })
  const [cooldown, setCooldown] = useState(0)
  const next = safeNext(search)
  const q = new URLSearchParams(next)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    const addr = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { setError('Please enter a valid email address.'); return }
    setBusy(true); setError(null)
    // The destination travels inside the link itself, so it works even if the email opens in another browser.
    const redirect = `${APP_URL}?from=email${next ? '&' + next.slice(1) : ''}`
    // FR-015: tell the server which group link this came from, so its admins can resend a confirmation if needed.
    // Stored by Supabase only for brand-new accounts. Invite tokens are hashed so the secret never leaves the browser.
    const data = await pendingContext(q)
    const { error } = await supabase.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: redirect, shouldCreateUser: true, data } })
    setBusy(false)
    if (error) { setError(friendlyError(error)); return }
    localStorage.setItem('pm:last-email', addr)
    savePending(addr); setCode('')
    setSentTo(addr); setCooldown(COOLDOWN)
  }

  // Signs in inside this browser, which matters when WhatsApp or a mail app opens links in its own browser.
  async function verify(e?: FormEvent) {
    e?.preventDefault()
    if (!sentTo) return
    const token = normaliseCode(code)
    if (!isCompleteCode(token)) { setError('Enter the 6-digit code from the email.'); return }
    setVerifying(true); setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: sentTo, token, type: 'email' })
    setVerifying(false)
    if (error) { setError(codeError(error)); return }
    savePending(null) // the session listener in App takes over and keeps the game/invite in the address bar
  }

  function differentEmail() { savePending(null); setSentTo(null); setCode(''); setError(null) }

  // The footer's handler keeps invite/game parameters; reuse it by clicking the footer link's equivalent.
  const openPrivacy = (e: React.MouseEvent) => {
    e.preventDefault()
    const q2 = new URLSearchParams(window.location.search); q2.set('view', 'privacy')
    history.pushState(null, '', window.location.pathname + '?' + q2.toString())
    window.dispatchEvent(new PopStateEvent('popstate'))
    window.scrollTo(0, 0)
  }

  const context = q.get('invite') ? 'You have been invited to a pickleball group. Sign in with your email to join.'
    : q.get('game') ? 'Sign in to see this game and add your name.'
    : 'Sign up for games, see who is playing, and drop out without the copy-paste.'

  return (
    <div className="signin">
      <div className="signin-hero">
        <Wordmark />
        <h1 className="display">Game on.</h1>
        <p className="lede">{context}</p>
      </div>
      <div className="card signin-card">
        {sentTo ? (
          <div className="stack">
            <h2>Check your email</h2>
            <p>We sent a sign-in email to <strong>{sentTo}</strong>. Enter the 6-digit code from it below, or tap the link in the email.</p>
            <form className="stack" onSubmit={verify} noValidate>
              <label className="field">
                <span>6-digit code</span>
                <input className="code-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*"
                  maxLength={CODE_MAX + 4} value={code} onChange={e => setCode(normaliseCode(e.target.value))}
                  placeholder="123456" aria-describedby="code-help" />
              </label>
              {error && <Notice tone="error">{error}</Notice>}
              <button className="btn btn-primary btn-lg" type="submit" disabled={verifying || !isCompleteCode(code)}>
                {verifying ? 'Signing in…' : 'Sign in with code'}
              </button>
            </form>
            <p id="code-help" className="muted small">The code and link work once and expire after an hour. Using the code keeps you signed in
              right here, even inside WhatsApp. No email after a minute? Check your spam or promotions folder.</p>
            <div className="row">
              <button className="btn" disabled={cooldown > 0 || busy} onClick={() => send()}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : busy ? 'Sending…' : 'Send a new code'}
              </button>
              <button className="btn btn-ghost" onClick={differentEmail}>Use a different email</button>
            </div>
          </div>
        ) : (
          <form className="stack" onSubmit={send} noValidate>
            <h2>Sign in with email</h2>
            <p className="muted">No password needed — we'll email you a 6-digit code and a one-tap sign-in link.</p>
            <label className="field">
              <span>Email address</span>
              <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
            </label>
            {error && <Notice tone="error">{error}</Notice>}
            <button className="btn btn-primary btn-lg" disabled={busy || cooldown > 0} type="submit">
              {busy ? 'Sending…' : cooldown > 0 ? `Wait ${cooldown}s` : 'Email me a sign-in code'}
            </button>
            <p className="privacy-notice">
              We use your email to sign you in and your display name to identify you in your pickleball groups.
              Your display name and game-signup status are visible to authorised group members; your email is not shown on player rosters.
              Read our <a href="?view=privacy" onClick={openPrivacy}>Privacy Policy</a> for information about service providers, retention and your choices.
            </p>
          </form>
        )}
      </div>
      {footer}
    </div>
  )
}

function codeError(e: unknown): string {
  const raw = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : ''
  const code = (e && typeof e === 'object' && 'code' in e) ? String((e as { code: unknown }).code) : ''
  if (code === 'otp_expired' || /expired|invalid/i.test(raw)) {
    return 'That code is wrong or has expired. Check the latest email, or send a new code.'
  }
  return friendlyError(e)
}
