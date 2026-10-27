import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { PENDING_KEY } from './lib/otp.js'
import { api, isOrganiser, type Me } from './lib/api'
import { endDeletedSession, isDeletedAccount, friendlyError } from './lib/errors'
import { isInfoView, isInviteToken, parseRoute, routeToSearch, withView, type Route } from './lib/route'
import { ToastProvider, Spinner, Notice, useToast } from './components/ui'
import { SignIn } from './screens/SignIn'
import { AuthConfirm } from './screens/AuthConfirm'
import { ProfileForm } from './screens/ProfileForm'
import { Home } from './screens/Home'
import { GameFeatures } from './screens/GameFeatures'
import { GameForm } from './screens/GameForm'
import { Members } from './screens/Members'
import { ActivityLog } from './screens/ActivityLog'
import { Wordmark } from './components/Wordmark'
import { Faq, Footer, PrivacyPolicy } from './screens/InfoPages'
function readHashError(): string | null {
  if (!window.location.hash.includes('error')) return null
  const h = new URLSearchParams(window.location.hash.slice(1)), code = h.get('error_code') || h.get('error')
  history.replaceState(null, '', window.location.pathname + window.location.search)
  if (code === 'otp_expired') return 'That sign-in link has expired or was already used. Enter your email to get a new one.'
  return h.get('error_description')?.replace(/\+/g, ' ') || 'Sign-in failed. Please request a new link.'
}
export default function App() { return <ToastProvider><Root /></ToastProvider> }
function Root() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [search, setSearch] = useState(window.location.search)
  const [hashError] = useState(readHashError)
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const { error } = await supabase.auth.getUser()
        const status = (error as { status?: number } | null)?.status
        if (error && (status === 401 || status === 403 || isDeletedAccount(error.message))) { endDeletedSession(); setSession(null); return }
      }
      setSession(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) { try { localStorage.removeItem(PENDING_KEY) } catch { /* private mode */ } }
      setSession(s)
      if (s && window.location.hash.includes('access_token')) history.replaceState(null, '', window.location.pathname + window.location.search)
    })
    const onPop = () => setSearch(window.location.search)
    window.addEventListener('popstate', onPop)
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('popstate', onPop) }
  }, [])
  const setUrl = useCallback((s: string, replace = false) => {
    const url = window.location.pathname + s
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url)
    setSearch(s); if (!replace) window.scrollTo(0, 0)
  }, [])
  if (new URLSearchParams(search).get('auth') === 'confirm') return <AuthConfirm search={search} onDone={next => setUrl(next, true)} />
  if (session === undefined) return <div className="page center"><Spinner /></div>
  const openInfo = (view: 'privacy' | 'faq') => setUrl(withView(search, view))
  if (!session) {
    if (isInfoView(search)) return <PublicInfo search={search} onNav={openInfo} onBack={() => setUrl(withView(search, null))} />
    return <SignIn search={search} initialError={hashError} footer={<Footer onNav={openInfo} dark />} />
  }
  return <SignedIn key={session.user.id} session={session} search={search} setUrl={setUrl} />
}
function PublicInfo({ search, onNav, onBack }: { search: string; onNav: (v: 'privacy' | 'faq') => void; onBack: () => void }) {
  return <div className="app"><header className="topbar"><div className="topbar-inner">
    <button className="brand" onClick={onBack} aria-label="PickleMe sign in"><Wordmark small /></button>
    <button className="btn btn-ghost btn-sm" onClick={onBack}>Sign in</button>
  </div></header><main className="page">
    {new URLSearchParams(search).get('view') === 'faq' ? <Faq onNav={onNav} /> : <PrivacyPolicy onNav={onNav} />}
  </main><Footer onNav={onNav} /></div>
}
function SignedIn({ session, search, setUrl }: { session: Session; search: string; setUrl: (s: string, replace?: boolean) => void }) {
  const toast = useToast()
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gameGroup, setGameGroup] = useState<{gameId:string;groupId:string}|null>(null)
  const inviteHandled = useRef<string|null>(null)
  const loadMe = useCallback(async () => {
    try { setMe(await api.getMe()); setError(null) } catch (e) { setError(friendlyError(e)) }
  }, [])
  // Redeem a group invite only once the user has a display name, so the activity log
  // records who joined. The ?invite= parameter stays in the URL until then.
  const redeemInvite = useCallback(async (currentSearch: string) => {
    const q = new URLSearchParams(currentSearch), invite = q.get('invite')
    if (!isInviteToken(invite) || inviteHandled.current===invite) return false
    inviteHandled.current=invite
    try {
      const r = await api.redeemInvite(invite)
      toast(r.already_member ? 'You are already in this group.' : 'Welcome — you have joined the group.')
      q.delete('invite'); setUrl(q.toString() ? `?${q}` : '', true)
      return true
    } catch (e) { toast(friendlyError(e), 'error'); return false }
  }, [setUrl, toast])
  useEffect(() => {
    let active=true
    void (async () => {
      try {
        const m = await api.getMe()
        if (!active) return
        if (m.display_name && await redeemInvite(search)) { if (active) await loadMe(); return }
        setMe(m); setError(null)
      } catch (e) { if (active) setError(friendlyError(e)) }
    })()
    return ()=>{active=false}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const route = parseRoute(search)
  const selectedGame = route.name==='game' || route.name==='edit-game' ? route.gameId : null
  useEffect(()=>{
    if(!selectedGame) return
    let active=true
    void (async()=>{
      const {data,error}=await supabase.rpc('preview_shared_game',{p_game_id:selectedGame})
      if(active && !error && data) setGameGroup({gameId:selectedGame,groupId:(data as {group_id:string}).group_id})
    })()
    return ()=>{active=false}
  },[selectedGame])
  const go = useCallback((r: Route) => setUrl(routeToSearch(r)), [setUrl])
  const signOut = async () => { await supabase.auth.signOut(); setUrl('', true) }
  if (error) return <Shell me={null} go={go} signOut={signOut}><Notice tone="error">{error}</Notice><button className="btn" onClick={loadMe}>Try again</button></Shell>
  if (!me) return <div className="page center"><Spinner /></div>
  if (!me.display_name && route.name !== 'privacy' && route.name !== 'faq') {
    return <div className="page narrow onboarding"><Wordmark /><h1 className="display">Welcome to PickleMe</h1>
      <p className="lede">Choose the name other players will see on the game lists.{isInviteToken(new URLSearchParams(search).get('invite')) ? ' You will join the group after you continue.' : ''}</p>
      <ProfileForm initial="" email={session.user.email ?? ''} onSaved={async () => { await redeemInvite(search); await loadMe() }} submitLabel="Continue" />
      <Footer onNav={v => setUrl(withView(search,v))} /></div>
  }
  const group = gameGroup ? me.groups.find(g=>g.id===gameGroup.groupId) : me.groups[0]
  const organiser = isOrganiser(group?.role)
  let body
  if (route.name === 'privacy' || route.name === 'faq') {
    body = route.name === 'faq' ? <Faq onNav={v => setUrl(withView(search,v))} /> : <PrivacyPolicy onNav={v => setUrl(withView(search,v))} />
  } else if (route.name === 'game') {
    body = <GameFeatures key={route.gameId} gameId={route.gameId} userId={session.user.id} go={go} onJoined={loadMe} />
  } else if (!group) {
    body = <div className="empty"><h1 className="display">You're signed in</h1>
      <p>Open a shared game link to join a group and game, or ask your organiser for a group invite.</p></div>
  } else if (route.name === 'activity') body = <ActivityLog key={group.id} group={group} />
  else if (route.name === 'new-game' && organiser) body = <GameForm group={group} go={go} />
  else if (route.name === 'edit-game' && organiser) body = <GameForm group={group} gameId={route.gameId} go={go} />
  else if (route.name === 'members') body = <Members group={group} userId={session.user.id} onGroupChanged={loadMe} />
  else if (route.name === 'profile') body = <section className="stack"><h1 className="display">Your profile</h1>
    <ProfileForm initial={me.display_name ?? ''} email={session.user.email ?? ''} submitLabel="Save name" onSaved={async () => { await loadMe(); toast('Name updated.') }} />
    <button className="btn btn-ghost" onClick={signOut}>Sign out</button></section>
  else body = <Home group={group} go={go} />
  return <Shell me={me} group={group} go={go} signOut={signOut} route={route} organiser={organiser}>{body}</Shell>
}
function Shell({ me, group, go, signOut, route, organiser, children }: {
  me: Me | null; group?: Me['groups'][number]; go: (r: Route) => void; signOut: () => void;
  route?: Route; organiser?: boolean; children: React.ReactNode
}) {
  const tab = route?.name
  return <div className="app"><header className="topbar"><div className="topbar-inner">
    <button className="brand" onClick={() => go({ name: 'home' })} aria-label="PickleMe home"><Wordmark small /></button>
    {group && <span className="group-name" title={group.name}>{group.name}</span>}
  </div>{me && <nav className="tabs" aria-label="Main">
    <button className={tab === 'home' || tab === 'game' ? 'active' : ''} onClick={() => go({ name: 'home' })}>Games</button>
    {group && <button className={tab === 'members' ? 'active' : ''} onClick={() => go({ name: 'members' })}>{organiser ? 'Members & invites' : 'Members'}</button>}
    {group?.role === 'admin' && <button className={tab === 'activity' ? 'active' : ''} onClick={() => go({ name: 'activity' })}>Activity log</button>}
    <button className={tab === 'profile' ? 'active' : ''} onClick={() => go({ name: 'profile' })}>{me.display_name ?? 'Profile'}</button>
  </nav>}{!me && <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>}</header>
  <main className="page">{children}</main><Footer onNav={v => go({ name: v })} /></div>
}
