import { useCallback, useEffect, useState } from 'react'
import { APP_URL } from '../lib/supabase'
import { api, isOrganiser, type Invite, type Me, type Member, type Role } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { copyText } from '../lib/clipboard'
import { ConfirmButton, Notice, Spinner, useToast } from '../components/ui'

const ROLE_LABEL: Record<Role, string> = { player: 'Player', organiser: 'Organiser', admin: 'Admin' }

export function Members({ group, userId }: { group: Me['groups'][number]; userId: string }) {
  const toast = useToast()
  const organiser = isOrganiser(group.role)
  const admin = group.role === 'admin'
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [newLink, setNewLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setMembers(await api.listMembers(group.id))
      if (organiser) setInvites(await api.listInvites(group.id))
      setError(null)
    } catch (e) { setError(friendlyError(e)) }
  }, [group.id, organiser])
  useEffect(() => { load() }, [load])

  async function createInvite() {
    setBusy(true)
    try {
      const r = await api.createInvite(group.id, 30, 200)
      setNewLink(`${APP_URL}?invite=${r.token}`)
      await load()
    } catch (e) { toast(friendlyError(e), 'error') }
    setBusy(false)
  }

  const inviteMessage = (link: string) =>
    `Join ${group.name} on PickleMe to sign up for games:\n${link}\n\nOpen the link, enter your email, and tap the sign-in link we send you. No password needed.`

  return (
    <section className="stack-lg">
      <h1 className="display">{organiser ? 'Members & invites' : 'Members'}</h1>
      {error && <Notice tone="error">{error}</Notice>}

      {organiser && (
        <div className="card stack">
          <h2>Invite players</h2>
          <p className="muted">Share one invite link in your WhatsApp group. Anyone who opens it and signs in joins {group.name}. Links last 30 days (up to 200 people) and can be turned off any time.</p>
          {newLink ? (
            <div className="stack">
              <Notice tone="ok">New invite link created. Copy it now — for security it is only shown once.</Notice>
              <code className="linkbox">{newLink}</code>
              <div className="row wrap">
                <button className="btn" onClick={async () => toast(await copyText(newLink) ? 'Invite link copied.' : 'Could not copy.')}>Copy link</button>
                <button className="btn" onClick={async () => toast(await copyText(inviteMessage(newLink)) ? 'Invite message copied.' : 'Could not copy.')}>Copy WhatsApp message</button>
                <a className="btn btn-whatsapp" href={`https://wa.me/?text=${encodeURIComponent(inviteMessage(newLink))}`} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a>
              </div>
            </div>
          ) : <button className="btn btn-primary" disabled={busy} onClick={createInvite}>{busy ? 'Creating…' : 'Create invite link'}</button>}
          {invites.length > 0 && (
            <ul className="invite-list">
              {invites.map(i => {
                const expired = new Date(i.expires_at).getTime() < Date.now()
                const state = i.revoked_at ? 'Turned off' : expired ? 'Expired' : i.use_count >= i.max_uses ? 'Used up' : 'Active'
                return (
                  <li key={i.id}>
                    <span>Created {new Date(i.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} · used {i.use_count}/{i.max_uses}</span>
                    <span className={`badge badge-${state === 'Active' ? 'open' : 'closed'}`}>{state}</span>
                    {state === 'Active' && <ConfirmButton className="btn btn-xs btn-ghost" confirmText="Turn off?"
                      onConfirm={async () => { try { await api.revokeInvite(i.id); toast('Invite link turned off.'); load() } catch (e) { toast(friendlyError(e), 'error') } }}>Turn off</ConfirmButton>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="card stack">
        <h2>Members {members && <span className="count">{members.length}</span>}</h2>
        {admin && <p className="small muted">As an admin you can make members organisers. Organisers can create, edit, close and cancel games and remove sign-ups.</p>}
        {!members ? <Spinner /> : (
          <ul className="member-list">
            {members.map(m => (
              <li key={m.user_id}>
                <span className="name">{m.display_name ?? 'New member'}{m.user_id === userId && <span className="you">you</span>}</span>
                {admin && m.user_id !== userId ? (
                  <select aria-label={`Role for ${m.display_name ?? 'member'}`} value={m.role}
                    onChange={async e => {
                      try { await api.setRole(group.id, m.user_id, e.target.value as Role); toast('Role updated.'); load() }
                      catch (err) { toast(friendlyError(err), 'error') }
                    }}>
                    {(['player', 'organiser', 'admin'] as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : <span className={`role role-${m.role}`}>{ROLE_LABEL[m.role]}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
