// Query-string routing so every URL resolves to /pickleme/index.html on GitHub Pages.
export type Route =
  | { name: 'home' }
  | { name: 'game'; gameId: string }
  | { name: 'new-game' }
  | { name: 'edit-game'; gameId: string }
  | { name: 'members' }
  | { name: 'profile' }
  | { name: 'privacy' }
  | { name: 'faq' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[0-9a-f]{20,80}$/i

export const isUuid = (s: string | null | undefined): s is string => !!s && UUID.test(s)
export const isInviteToken = (s: string | null | undefined): s is string => !!s && TOKEN.test(s)

export function parseRoute(search: string): Route {
  const q = new URLSearchParams(search)
  const game = q.get('game')
  const view = q.get('view')
  if (view === 'new') return { name: 'new-game' }
  if (view === 'edit' && isUuid(game)) return { name: 'edit-game', gameId: game }
  if (view === 'members') return { name: 'members' }
  if (view === 'profile') return { name: 'profile' }
  if (view === 'privacy') return { name: 'privacy' }
  if (view === 'faq') return { name: 'faq' }
  if (isUuid(game)) return { name: 'game', gameId: game }
  return { name: 'home' }
}

export function routeToSearch(r: Route): string {
  switch (r.name) {
    case 'home': return ''
    case 'game': return `?game=${r.gameId}`
    case 'new-game': return '?view=new'
    case 'edit-game': return `?view=edit&game=${r.gameId}`
    case 'members': return '?view=members'
    case 'profile': return '?view=profile'
    case 'privacy': return '?view=privacy'
    case 'faq': return '?view=faq'
  }
}

/** Info pages (privacy, FAQ) are public. Keep other parameters (invite, game) so nothing is lost on the way back. */
export const isInfoView = (search: string) => ['privacy', 'faq'].includes(new URLSearchParams(search).get('view') ?? '')
export function withView(search: string, view: string | null): string {
  const q = new URLSearchParams(search)
  if (view) q.set('view', view); else q.delete('view')
  const s = q.toString()
  return s ? `?${s}` : ''
}

/**
 * Only internal, validated destinations survive the sign-in round trip (no open redirects).
 * Returns a query string such as "?game=<uuid>&invite=<token>" or "".
 */
export function safeNext(search: string): string {
  const q = new URLSearchParams(search)
  const out = new URLSearchParams()
  const game = q.get('game'); const invite = q.get('invite'); const view = q.get('view')
  if (isUuid(game)) out.set('game', game)
  if (isInviteToken(invite)) out.set('invite', invite)
  if (view && ['new', 'edit', 'members', 'profile'].includes(view)) out.set('view', view)
  const s = out.toString()
  return s ? `?${s}` : ''
}
