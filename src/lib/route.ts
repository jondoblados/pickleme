export type Route =
  | { name: 'home' } | { name: 'game'; gameId: string } | { name: 'new-game' }
  | { name: 'edit-game'; gameId: string } | { name: 'members' } | { name: 'activity' }
  | { name: 'profile' } | { name: 'privacy' } | { name: 'faq' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[0-9a-f]{20,80}$/i
export const isUuid = (s: string | null | undefined): s is string => !!s && UUID.test(s)
export const isInviteToken = (s: string | null | undefined): s is string => !!s && TOKEN.test(s)
export function parseRoute(search: string): Route {
  const q = new URLSearchParams(search), game = q.get('game'), view = q.get('view')
  if (view === 'new') return { name: 'new-game' }
  if (view === 'edit' && isUuid(game)) return { name: 'edit-game', gameId: game }
  if (view === 'members' || view === 'activity' || view === 'profile' || view === 'privacy' || view === 'faq') return { name: view }
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
    case 'activity': return '?view=activity'
    case 'profile': return '?view=profile'
    case 'privacy': return '?view=privacy'
    case 'faq': return '?view=faq'
  }
}
export const isInfoView = (search: string) => ['privacy', 'faq'].includes(new URLSearchParams(search).get('view') ?? '')
export function withView(search: string, view: string | null): string {
  const q = new URLSearchParams(search)
  if (view) q.set('view', view); else q.delete('view')
  const s = q.toString(); return s ? `?${s}` : ''
}
export function safeNext(search: string): string {
  const q = new URLSearchParams(search), out = new URLSearchParams()
  const game = q.get('game'), invite = q.get('invite'), view = q.get('view')
  if (isUuid(game)) out.set('game', game)
  if (isInviteToken(invite)) out.set('invite', invite)
  if (view && ['new', 'edit', 'members', 'activity', 'profile'].includes(view)) out.set('view', view)
  const s = out.toString(); return s ? `?${s}` : ''
}
