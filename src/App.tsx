import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { api, isOrganiser, type Me } from './lib/api'
import { friendlyError } from './lib/errors'
import { isInfoView, isInviteToken, parseRoute, routeToSearch, withView, type Route } from './lib/route'
import { ToastProvider, Spinner, Notice, useToast } from './components/ui'
import { SignIn } from './screens/SignIn'
import { AuthConfirm } from './screens/AuthConfirm'
import { ProfileForm } from './screens/ProfileForm'
import { Home } from './screens/Home'
import { GamePage } from './screens/GamePage'
import { GameForm } from './screens/GameForm'
import { Members } from './screens/Members'
import { Wordmark } from './components/Wordmark'
import { Faq, Footer, PrivacyPolicy } from './screens/InfoPages'

function readHashError(): string | null {
  if (!window.location.hash.includes('error')) return null
  const h = new URLSearchParams(window.location.hash.slice(1))
  const code = h.get('error_code') || h.get('error')
  history.replaceState(null, '', window.location.pathname + window.location.search)
  if (code === 'otp_expired') return 'That sign-in link has expired or was already used. Enter your email to get a new one.'
  return h.get('error_description')?.replace(/\+/g, ' ') || 'Sign-in failed. Please request a new link.'
}

export default function App() {
  return <ToastProvider><Root /></ToastProvider>
}

function Root() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [search, setSearch] = useState(window.location.search)
  const [hashError] = useState(readHashError)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      // Remove tokens from the address bar after implicit-flow sign-in.
      if (s && window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    })
    const onPop = () => setSearch(window.location.search)
    window.addEventListener('popstate', onPop)
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('popstate', onPop) }
  }, [])

  const setUrl = useCallback((s: string, replace = false) => {
    const url = window.location.pathname + s
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url)
    setSearch(s)
    if (!replace) window.scrollTo(0, 0)
  }, [])

  const q = new URLSearchParams(search)
  if (q.get('auth') === 'confirm') return <AuthConfirm search={search} onDone={next => setUrl(next, true)} />
  if (session === undefined) return <div className="page center"><Spinner /></div>
  const openInfo = (view: 'privacy' | 'faq') => setUrl(withView(search, view))
  if (!session) {
    if (isInfoView(search)) return <PublicInfo search={search} onNav={openInfo} onBack={() => setUrl(withView(search, null))} />
    return <SignIn search={search} initialError={hashError} footer={<Footer onNav={openInfo} dark />} />
  }
  return <SignedIn session={session} search={search} setUrl={setUrl} />
}

function PublicInfo({ search, onNav, onBack }: { search: string; onNav: (v: 'privacy' | 'faq') => void; onBack: () => void }) {
  const view = new URLSearchParams(search).get('view')
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={onBack} aria-label="PickleMe sign in"><Wordmark small /></button>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>Sign in</button>
        </div>
      </header>
      <main className="page">
        {view === 'faq' ? <Faq onNav={onNav} /> : <PrivacyPolicy onNav={onNav} />}
      </main>
      <Footer onNav={onNav} />
    </div>
  )
}

function SignedIn({ session, search, setUrl }: { session: Session; search: string; setUrl: (s: string, replace?: boolean) => void }) {
  const toast = useToast()
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inviteHandled = useRef(false)

  const loadMe = useCallback(async () => {
    try { setMe(await api.getMe()); setError(null) } catch (e) { setError(friendlyError(e)) }
  }, [])

  useEffect(() => {
    (async () => {
      const q = new URLSearchParams(search)
      const invite = q.get('invite')
      if (isInviteToken(invite) && !inviteHandled.current) {
        inviteHandled.current = true
        try {
          const r = await api.redeemInvite(invite)
          toast(r.already_member ? 'You are already in this group.' : 'Welcome — you have joined the group.')
        } catch (e) { toast(friendlyError(e), 'error') }
        q.delete('invite')
        const s = q.toString()
        setUrl(s ? `?${s}` : '', true)
      }
      await loadMe()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const route = parseRoute(search)
  const go = useCallback((r: Route) => setUrl(routeToSearch(r)), [setUrl])
  const signOut = async () => { await supabase.auth.signOut(); setUrl('', true) }

  if (error) return <Shell me={null} go={go} signOut={signOut}><Notice tone="error">{error}</Notice>
    <button className="btn" onClick={loadMe}>Try again</button></Shell>
  if (!me) return <div className="page center"><Spinner /></div>

  if (!me.display_name && route.name !== 'privacy' && route.name !== 'faq') {
    return <div className="page narrow onboarding">
      <Wordmark />
      <h1 className="display">Welcome to PickleMe</h1>
      <p className="lede">Choose the name other players will see on the game lists.</p>
      <ProfileForm initial="" email={session.user.email ?? ''} onSaved={loadMe} submitLabel="Continue" />
      <Footer onNav={v => go({ name: v })} />
    </div>
  }

  const group = me.groups[0]
  const organiser = isOrganiser(group?.role)

  let body
  if (route.name === 'privacy' || route.name === 'faq') {
    body = route.name === 'faq' ? <Faq onNav={v => go({ name: v })} /> : <PrivacyPolicy onNav={v => go({ name: v })} />
  } else if (!group) {
    body = <div className="empty">
      <h1 className="display">You're signed in</h1>
      <p>You are not in a pickleball group yet. Ask an organiser in your WhatsApp group for the PickleMe invite link, then open it on this device.</p>
    </div>
  } else if (route.name === 'game') {
    body = <GamePage gameId={route.gameId} userId={session.user.id} go={go} />
  } else if (route.name === 'new-game' && organiser) {
    body = <GameForm group={group} go={go} />
  } else if (route.name === 'edit-game' && organiser) {
    body = <GameForm group={group} gameId={route.gameId} go={go} />
  } else if (route.name === 'members') {
    body = <Members group={group} userId={session.user.id} />
  } else if (route.name === 'profile') {
    body = <section className="stack">
      <h1 className="display">Your profile</h1>
      <ProfileForm initial={me.display_name ?? ''} email={session.user.email ?? ''} submitLabel="Save name"
        onSaved={async () => { await loadMe(); toast('Name updated.') }} />
      <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
    </section>
  } else {
    body = <Home group={group} go={go} />
  }

  return <Shell me={me} go={go} signOut={signOut} route={route} organiser={organiser}>{body}</Shell>
}

function Shell({ me, go, signOut, route, organiser, children }:
  { me: Me | null; go: (r: Route) => void; signOut: () => void; route?: Route; organiser?: boolean; children: React.ReactNode }) {
  const group = me?.groups[0]
  const tab = route?.name
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => go({ name: 'home' })} aria-label="PickleMe home">
            <Wordmark small />
          </button>
          {group && <span className="group-name" title={group.name}>{group.name}</span>}
        </div>
        {me && (
          <nav className="tabs" aria-label="Main">
            <button className={tab === 'home' || tab === 'game' ? 'active' : ''} onClick={() => go({ name: 'home' })}>Games</button>
            {group && <button className={tab === 'members' ? 'active' : ''} onClick={() => go({ name: 'members' })}>{organiser ? 'Members & invites' : 'Members'}</button>}
            <button className={tab === 'profile' ? 'active' : ''} onClick={() => go({ name: 'profile' })}>{me.display_name ?? 'Profile'}</button>
          </nav>
        )}
        {!me && <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>}
      </header>
      <main className="page">{children}</main>
      <Footer onNav={v => go({ name: v })} />
    </div>
  )
}
