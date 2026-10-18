import { supabase } from './supabase'

export type Role = 'player' | 'organiser' | 'admin'
export type GameStatus = 'open' | 'closed' | 'cancelled'
export type MyStatus = { status: 'playing' | 'waitlist' | null; position?: number }

export interface Me {
  user_id: string
  display_name: string | null
  groups: { id: string; name: string; role: Role; timezone: string; default_capacity: number }[]
}
export interface GameSummary {
  id: string; group_id: string; group_name: string; timezone: string; title: string
  starts_at: string; ends_at: string; location: string; capacity: number; status: GameStatus
  playing: number; waitlist: number; me: MyStatus
}
export interface RosterEntry {
  user_id: string; display_name: string; joined_at: string; rank: number
  status: 'playing' | 'waitlist'; position: number
}
export interface GameDetail {
  game: { id: string; title: string; starts_at: string; ends_at: string; location: string; capacity: number
          notes: string; status: GameStatus; updated_at: string }
  group: { id: string; name: string; timezone: string }
  my_role: Role
  me: MyStatus
  roster: RosterEntry[]
}
export interface Member { user_id: string; display_name: string | null; role: Role; joined_at: string }
export interface Invite { id: string; expires_at: string; max_uses: number; use_count: number; revoked_at: string | null; created_at: string }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const api = {
  getMe: () => rpc<Me>('get_me'),
  setDisplayName: (name: string) => rpc('set_display_name', { p_name: name }),
  redeemInvite: (token: string) => rpc<{ group_id: string; already_member: boolean }>('redeem_invite', { p_token: token }),
  listGames: (past = false) => rpc<GameSummary[]>('list_games', { p_include_past: past }),
  getGame: (id: string) => rpc<GameDetail>('get_game', { p_game_id: id }),
  join: (id: string) => rpc<MyStatus & { already_registered: boolean }>('join_game', { p_game_id: id }),
  withdraw: (id: string) => rpc<{ cancelled: boolean; promoted: number }>('withdraw_game', { p_game_id: id }),
  removeRegistration: (gameId: string, userId: string) =>
    rpc('remove_registration', { p_game_id: gameId, p_user_id: userId }),
  createGame: (g: { groupId: string; title: string; startsAt: string; endsAt: string; location: string; capacity: number; notes: string }) =>
    rpc<string>('create_game', { p_group_id: g.groupId, p_title: g.title, p_starts_at: g.startsAt, p_ends_at: g.endsAt,
      p_location: g.location, p_capacity: g.capacity, p_notes: g.notes }),
  updateGame: (id: string, g: { title: string; startsAt: string; endsAt: string; location: string; capacity: number; notes: string }) =>
    rpc<{ promoted: number }>('update_game', { p_game_id: id, p_title: g.title, p_starts_at: g.startsAt, p_ends_at: g.endsAt,
      p_location: g.location, p_capacity: g.capacity, p_notes: g.notes }),
  setStatus: (id: string, status: GameStatus) => rpc('set_game_status', { p_game_id: id, p_status: status }),
  listMembers: (groupId: string) => rpc<Member[]>('list_members', { p_group_id: groupId }),
  setRole: (groupId: string, userId: string, role: Role) =>
    rpc('set_member_role', { p_group_id: groupId, p_user_id: userId, p_role: role }),
  createInvite: (groupId: string, days = 30, maxUses = 200) =>
    rpc<{ id: string; token: string; expires_at: string; max_uses: number }>('create_invite',
      { p_group_id: groupId, p_valid_days: days, p_max_uses: maxUses }),
  revokeInvite: (id: string) => rpc('revoke_invite', { p_invite_id: id }),
  listInvites: async (groupId: string) => {
    const { data, error } = await supabase.from('group_invites')
      .select('id, expires_at, max_uses, use_count, revoked_at, created_at')
      .eq('group_id', groupId).order('created_at', { ascending: false })
    if (error) throw error
    return data as Invite[]
  },
}

export const isOrganiser = (r: Role | undefined) => r === 'organiser' || r === 'admin'
