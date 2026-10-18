import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { Notice } from '../components/ui'

export function ProfileForm({ initial, email, onSaved, submitLabel }:
  { initial: string; email: string; onSaved: () => void | Promise<void>; submitLabel: string }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Please enter a name.'); return }
    setBusy(true); setError(null)
    try { await api.setDisplayName(name.trim()); await onSaved() } catch (err) { setError(friendlyError(err)) }
    setBusy(false)
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <label className="field">
        <span>Display name</span>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={40} autoComplete="nickname"
          placeholder="e.g. Jon D" required />
        <small className="muted">Use the name your group knows you by. Shown on game lists; your email is never shown.</small>
      </label>
      {email && <p className="muted small">Signed in as {email}</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Saving…' : submitLabel}</button>
    </form>
  )
}
