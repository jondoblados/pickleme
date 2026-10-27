import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { APP_URL } from '../lib/supabase'
import { api, isOrganiser, type GameLinkJoin, type Invite, type Me, type Member, type PendingSignup, type Role } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { copyText } from '../lib/clipboard'
import { ConfirmButton, Notice, Spinner, useToast } from '../components/ui'
import { Avatar } from '../components/Avatar'

const ROLE_LABEL: Record<Role, string> = { player: 'Player', organiser: 'Organiser', admin: 'Admin' }

export function Members({ group, userId, onGroupChanged }: { group: Me['groups'][number]; userId: string; onGroupChanged?: () => void | Promise<void> }) {
  const toast = useToast()
  const organiser = isOrganiser(group.role)
  const admin = group.role === 'admin'
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [gameJoins, setGameJoins] = useState<GameLinkJoin[]>([])
  const [newLink, setNewLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setMembers(await api.listMembers(group.id))
      if (organiser) {
        const [inv, gj] = await Promise.all([api.listInvites(group.id), api.listGameLinkJoins(group.id)])
        setInvites(inv); setGameJoins(gj)
      }
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
    `Join ${group.name} on PickleMe to sign up for games:\n${link}\n\nOpen the link, enter your email, then type the 6-digit code we email you (or tap the button in the email). No password needed.`

  return (
    <section className="stack-lg">
      <h1 className="display">{organiser ? 'Members & invites' : 'Members'}</h1>
      {error && <Notice tone="error">{error}</Notice>}

      {admin && <GroupNameCard group={group} onSaved={onGroupChanged} />}

      {organiser && (
        <div className="card stack">
          <h2>Invite players</h2>
          <p className="muted">Share one invite link in your WhatsApp group. Anyone who opens it and signs in joins {group.name}. Links last 30 days (up to 200 people) and can be turned off any time.</p>
          {newLink ? (
            <div className="stack">
              <Notice tone="ok">New invite link created. You can copy it again later from the list below while it is active.</Notice>
              <code className="linkbox">{newLink}</code>
              <div className="row wrap">
                <button className="btn" onClick={async () => toast(await copyText(newLink) ? 'Invite link copied.' : 'Could not copy.')}>Copy link</button>
                <button className="btn" onClick={async () => toast(await copyText(inviteMessage(newLink)) ? 'Invite message copied.' : 'Could not copy.')}>Copy WhatsApp message</button>
                <a className="btn btn-whatsapp" href={`https://wa.me/?text=${encodeURIComponent(inviteMessage(newLink))}`} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a>
              </div>
            </div>
          ) : <button className="btn btn-primary" disabled={busy} onClick={createInvite}>{busy ? 'Creating…' : 'Create invite link'}</button>}
          {invites.length > 0 && (
            <div className="invite-list">
              {invites.map(i => {
                const expired = new Date(i.expires_at).getTime() < Date.now()
                const state = i.revoked_at ? 'Turned off' : expired ? 'Expired' : i.use_count >= i.max_uses ? 'Used up' : 'Active'
                const active = state === 'Active'
                const isNew = Date.now() - new Date(i.created_at).getTime() < 86400000
                const tail = i.revoked_at ? `turned off ${fmtDate(i.revoked_at)}` : expired ? `expired ${fmtDate(i.expires_at)}` : `expires ${fmtDate(i.expires_at)}`
                async function copy(kind: 'link' | 'message') {
                  try {
                    const { token } = await api.getInviteLink(i.id)
                    const link = `${APP_URL}?invite=${token}`
                    const ok = await copyText(kind === 'link' ? link : inviteMessage(link))
                    toast(ok ? (kind === 'link' ? 'Invite link copied.' : 'Invite message copied.') : 'Could not copy.')
                  } catch (e) { toast(friendlyError(e), 'error') }
                }
                return (
                  <div className="inv" key={i.id}>
                    <div className="inv-top">
                      <span className="inv-meta"><b>Created {fmtDate(i.created_at)}</b>{isNew && <span className="newflag">new</span>}
                        <span className="inv-sub">by {i.created_by_name} · used {i.use_count}/{i.max_uses} · {tail}</span></span>
                      <span className={`badge badge-${active ? 'open' : 'closed'}`}>{state}</span>
                    </div>
                    {active && <div className="inv-actions">
                      <button className="btn btn-xs" disabled={!i.copyable} onClick={() => copy('link')}><IconCopy />Copy link</button>
                      {i.copyable && <button className="btn btn-xs" onClick={() => copy('message')}>Copy WhatsApp message</button>}
                      <ConfirmButton className="btn btn-xs btn-ghost" confirmText="Turn off?"
                        onConfirm={async () => { try { await api.revokeInvite(i.id); toast('Invite link turned off.'); load() } catch (e) { toast(friendlyError(e), 'error') } }}>Turn off</ConfirmButton>
                    </div>}
                    {active && !i.copyable && <p className="legacy">This link was created before copying was available, so it can't be shown again. It still works for anyone who has it. To share a fresh copy, create a new link (and turn this one off if you like).</p>}
                    {i.joined.length > 0 && <JoinedList title={`Joined with this link (${i.joined.length})`} open={active}
                      rows={i.joined.map(j => ({ key: j.user_id + j.joined_at, userId: j.user_id, avatar: j.avatar_path, name: j.name, when: fmtWhen(j.joined_at) }))} />}
                  </div>
                )
              })}
            </div>
          )}
          {gameJoins.length > 0 && <JoinedList title={`Joined from a game link (${gameJoins.length})`} open={false}
            rows={gameJoins.map(j => ({ key: j.user_id + j.joined_at, userId: j.user_id, avatar: j.avatar_path, name: j.name, when: fmtWhen(j.joined_at),
              sub: j.game + (j.game_starts_at ? ` · ${fmtDate(j.game_starts_at)}` : '') }))} />}
        </div>
      )}

      {admin && <PendingSignupsCard groupId={group.id} />}

      <div className="card stack">
        <h2>Members {members && <span className="count">{members.length}</span>}</h2>
        {admin && <p className="small muted">As an admin you can make members organisers. Organisers can create, edit, close and cancel games and remove sign-ups.</p>}
        {!members ? <Spinner /> : (
          <ul className="member-list">
            {members.map(m => (
              <li key={m.user_id}>
                <Avatar userId={m.user_id} name={m.display_name} path={m.avatar_path} size={32} />
                <span className="name">{m.display_name ?? 'New member'}{m.user_id === userId && <span className="you">you</span>}
                  {admin && m.email_confirmed === false && <span className="badge badge-unconfirmed" title="This member has not confirmed their email address">Not confirmed</span>}</span>
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

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// FR-015: admins only. Lists people who asked to sign in from this group's links but never confirmed their email.
function PendingSignupsCard({ groupId }: { groupId: string }) {
  const toast = useToast()
  const [rows, setRows] = useState<PendingSignup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setRows(await api.listPendingSignups(groupId)); setError(null) } catch (e) { setError(friendlyError(e)) }
  }, [groupId])
  useEffect(() => { load() }, [load])
  if (!rows && !error) return null
  if (rows && rows.length === 0) return null
  async function resend(r: PendingSignup) {
    setSending(r.user_id)
    try { await api.resendVerification(groupId, r.user_id); toast(`Confirmation email sent to ${r.masked_email}.`); await load() }
    catch (e) { toast(friendlyError(e), 'error') }
    setSending(null)
  }
  return (
    <div className="card stack">
      <h2>Waiting for email confirmation {rows && <span className="count">{rows.length}</span>}</h2>
      <p className="small muted">These people opened one of this group's links and asked to sign in, but haven't used the code or link
        from their email yet. Only part of each email address is shown. Resending sends a fresh code and link to their address.
        Entries disappear once they confirm, and after 30 days.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {rows && <ul className="member-list pending-list">
        {rows.map(r => {
          const wait = r.resend_available_at && new Date(r.resend_available_at).getTime() > Date.now()
          return (
            <li key={r.user_id}>
              <span className="name">{r.masked_email}
                <span className="joined-sub">{r.source === 'game' ? `From game link${r.game_title ? ` · ${r.game_title}` : ''}${r.game_starts_at ? ` · ${fmtDate(r.game_starts_at)}` : ''}` : 'From group invite link'}
                  {' · '}signed up {fmtWhen(r.signed_up_at)}{r.last_email_at ? ` · last email ${fmtWhen(r.last_email_at)}` : ''}</span></span>
              <span className="row">
                <button className="btn btn-xs" disabled={!!wait || sending === r.user_id} onClick={() => resend(r)}
                  title={wait ? 'You can resend 10 minutes after the last confirmation email' : undefined}>
                  {sending === r.user_id ? 'Sending…' : wait ? 'Sent' : 'Resend email'}</button>
                <ConfirmButton className="btn btn-xs btn-ghost" confirmText="Dismiss?"
                  onConfirm={async () => { try { await api.dismissPendingSignup(groupId, r.user_id); toast('Removed from the list.'); load() } catch (e) { toast(friendlyError(e), 'error') } }}>Dismiss</ConfirmButton>
              </span>
            </li>
          )
        })}
      </ul>}
    </div>
  )
}

function JoinedList({ title, rows, open }: { title: string; open: boolean; rows: { key: string; userId?: string; avatar?: string | null; name: string; when: string; sub?: string }[] }) {
  return (
    <details className="joined" open={open}>
      <summary>{title}</summary>
      <ul>{rows.map(r => <li key={r.key}><span className="joined-who"><Avatar userId={r.userId} name={r.name} path={r.avatar} size={24} /><span>{r.name}{r.sub && <span className="joined-sub">{r.sub}</span>}</span></span><span className="when">{r.when}</span></li>)}</ul>
    </details>
  )
}

function IconCopy() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
}

function GroupNameCard({ group, onSaved }: { group: Me['groups'][number]; onSaved?: () => void | Promise<void> }) {
  const toast = useToast()
  const [name, setName] = useState(group.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setName(group.name) }, [group.name])
  const tidy = name.trim().replace(/\s+/g, ' ')
  const unchanged = tidy === group.name
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!tidy) { setError('Please enter a group name.'); return }
    setBusy(true); setError(null)
    try { const r = await api.renameGroup(group.id, tidy); await onSaved?.(); toast(r.changed ? 'Group name updated.' : 'No change.') }
    catch (err) { setError(friendlyError(err)) }
    setBusy(false)
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Group name</h2>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={80} required aria-describedby="group-name-help" />
        <small id="group-name-help" className="muted">Admins only. Shown to all members at the top of the app, on game pages and in invite messages.</small>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="row wrap">
        <button className="btn btn-primary" type="submit" disabled={busy || unchanged}>{busy ? 'Saving…' : 'Save name'}</button>
        {!unchanged && <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { setName(group.name); setError(null) }}>Cancel</button>}
      </div>
    </form>
  )
}
