import { useEffect, useState, type FormEvent } from 'react'
import { supabase, APP_URL } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { safeNext } from '../lib/route'
import { Notice } from '../components/ui'
import { Wordmark } from '../components/Wordmark'

const COOLDOWN = 60

export function SignIn({ search, initialError }: { search: string; initialError: string | null }) {
  const [email, setEmail] = useState(() => localStorage.getItem('pm:last-email') ?? '')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
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
    const { error } = await supabase.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: redirect, shouldCreateUser: true } })
    setBusy(false)
    if (error) { setError(friendlyError(error)); return }
    localStorage.setItem('pm:last-email', addr)
    setSentTo(addr); setCooldown(COOLDOWN)
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
            <p>We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this phone to continue. The link works once and expires after an hour.</p>
            <p className="muted small">No email after a minute? Check your spam or promotions folder.</p>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="row">
              <button className="btn" disabled={cooldown > 0 || busy} onClick={() => send()}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : busy ? 'Sending…' : 'Resend link'}
              </button>
              <button className="btn btn-ghost" onClick={() => { setSentTo(null); setError(null) }}>Use a different email</button>
            </div>
          </div>
        ) : (
          <form className="stack" onSubmit={send} noValidate>
            <h2>Sign in with email</h2>
            <p className="muted">No password needed — we'll email you a one-tap sign-in link.</p>
            <label className="field">
              <span>Email address</span>
              <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
            </label>
            {error && <Notice tone="error">{error}</Notice>}
            <button className="btn btn-primary btn-lg" disabled={busy || cooldown > 0} type="submit">
              {busy ? 'Sending…' : cooldown > 0 ? `Wait ${cooldown}s` : 'Email me a sign-in link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
