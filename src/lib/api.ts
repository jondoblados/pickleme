import { supabase } from './supabase'
import type { WeatherResponse } from './weather-core.js'
import type { Cancellation, CancelReasonCode } from './cancel-reasons.js'
export type { Cancellation, CancelReasonCode }

export type Role = 'player' | 'organiser' | 'admin'
export type GameStatus = 'open' | 'closed' | 'cancelled'
export type MyStatus = { status: 'playing' | 'waitlist' | null; position?: number }
/** FR-021: when a game appears to players. Organisers and admins always see it. */
export type Visibility = 'now' | 'week_before' | 'two_weeks_before'
export type PayeeKind = 'organiser' | 'nominated'
/** FR-021: court booking fee summary. Amounts are in cents (SGD only for now). */
export interface FeeSummary {
  total_cents: number; currency: 'SGD'
  /** People the fee is split between: playing now, or the attendance list minus Excused once the game has started. */
  basis: number
  share_cents: number | null
  share_if_full_cents: number | null
  /** True once the game has ended and every player on the attendance list is marked. */
  final: boolean
  previous_cents: number | null; updated_at: string | null
}
export interface GameFee extends FeeSummary {
  /** Shown only to organisers, admins and players who owe a share. */
  payee: { kind: PayeeKind; name: string; mobile: string } | null
  changed_since_join: boolean
}
export interface SlotConfirmation {
  required: boolean; opens_at: string; closes_at: string; open: boolean; confirmed_at: string | null
}
export interface SlotConfirmationRow {
  user_id: string; name: string; avatar_path?: string | null; position: number
  confirmed_at: string | null; mobile: string | null
}
export interface FeeSettings {
  total_cents: number | null; currency: 'SGD'
  payee: { kind: PayeeKind; name: string | null; mobile: string; user_id: string | null } | null
}

export interface Me {
  user_id: string
  display_name: string | null
  avatar_path?: string | null
  groups: { id: string; name: string; role: Role; timezone: string; default_capacity: number }[]
}
export interface GameSummary {
  id: string; group_id: string; group_name: string; timezone: string; title: string
  starts_at: string; ends_at: string; location: string; capacity: number; status: GameStatus
  /** FR-019: the organiser's reason, for cancelled games only. */
  cancel_reason?: string | null
  playing: number; waitlist: number; me: MyStatus
  visibility?: Visibility
  /** Organisers and admins only: when a scheduled game appears to players. */
  visible_from?: string | null
  fee?: FeeSummary | null
}
export interface RosterEntry {
  user_id: string; display_name: string; avatar_path?: string | null; joined_at: string; rank: number
  status: 'playing' | 'waitlist'; position: number
}
export interface GameDetail {
  game: { id: string; title: string; starts_at: string; ends_at: string; location: string; capacity: number
          notes: string; status: GameStatus; updated_at: string
          /** FR-019: null unless cancelled. reason is null for games cancelled before reasons were required. */
          cancellation?: Cancellation | null
          visibility?: Visibility; visible_from?: string | null
          fee?: GameFee | null }
  group: { id: string; name: string; timezone: string }
  my_role: Role
  me: MyStatus
  roster: RosterEntry[]
  /** FR-021: game-day slot confirmation, for paid games only. */
  confirmation?: SlotConfirmation | null
}
export interface Member { user_id: string; display_name: string | null; avatar_path?: string | null; role: Role; joined_at: string
  /** Admins only: false when the member's email is not confirmed. null for everyone else. */
  email_confirmed?: boolean | null }
export interface PendingSignup {
  user_id: string; masked_email: string; signed_up_at: string; last_email_at: string | null
  resend_available_at: string | null; source: 'game' | 'invite'; game_title: string | null; game_starts_at: string | null
}
export interface Invite {
  id: string; expires_at: string; max_uses: number; use_count: number; revoked_at: string | null; created_at: string
  created_by_name: string; copyable: boolean; joined: { user_id: string; name: string; avatar_path?: string | null; joined_at: string }[]
}
export interface GameLinkJoin { user_id: string; name: string; avatar_path?: string | null; joined_at: string; game_id: string | null; game: string; game_starts_at: string | null }

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
  createGame: (g: { groupId: string; title: string; startsAt: string; endsAt: string; location: string; capacity: number; notes: string; visibility: Visibility }) =>
    rpc<string>('create_game', { p_group_id: g.groupId, p_title: g.title, p_starts_at: g.startsAt, p_ends_at: g.endsAt,
      p_location: g.location, p_capacity: g.capacity, p_notes: g.notes, p_visibility: g.visibility }),
  updateGame: (id: string, g: { title: string; startsAt: string; endsAt: string; location: string; capacity: number; notes: string; visibility: Visibility }) =>
    rpc<{ promoted: number }>('update_game', { p_game_id: id, p_title: g.title, p_starts_at: g.startsAt, p_ends_at: g.endsAt,
      p_location: g.location, p_capacity: g.capacity, p_notes: g.notes, p_visibility: g.visibility }),
  /** FR-021: set, change or remove (totalCents null) the court booking fee. Organisers and admins only. */
  setGameFee: (id: string, totalCents: number | null, payee?: { kind: PayeeKind; name?: string; mobile: string }) =>
    rpc<{ changed: boolean }>('set_game_fee', { p_game_id: id, p_total_cents: totalCents,
      p_payee_kind: payee?.kind ?? 'organiser', p_payee_name: payee?.name ?? null, p_payee_mobile: payee?.mobile ?? null }),
  getGameFeeSettings: (id: string) => rpc<FeeSettings>('get_game_fee_settings', { p_game_id: id }),
  confirmSlot: (id: string, mobile: string) => rpc<{ confirmed_at: string }>('confirm_slot', { p_game_id: id, p_mobile: mobile }),
  listSlotConfirmations: (id: string) => rpc<SlotConfirmationRow[]>('list_slot_confirmations', { p_game_id: id }),
  renameGroup: (groupId: string, name: string) => rpc<{ id: string; name: string; changed: boolean }>('rename_group', { p_group_id: groupId, p_name: name }),
  deleteGame: (id: string) => rpc<{ deleted: boolean; title: string }>('delete_game', { p_game_id: id }),
  /** FR-019: cancelling always needs a reason; setStatus only opens and closes registration. */
  cancelGame: (id: string, code: CancelReasonCode, reason: string) =>
    rpc<{ cancelled: boolean; reason: string }>('cancel_game', { p_game_id: id, p_reason_code: code, p_reason: reason }),
  updateCancelReason: (id: string, code: CancelReasonCode, reason: string) =>
    rpc<{ changed: boolean; reason: string }>('update_cancel_reason', { p_game_id: id, p_reason_code: code, p_reason: reason }),
  setStatus: (id: string, status: Exclude<GameStatus, 'cancelled'>) => rpc('set_game_status', { p_game_id: id, p_status: status }),
  listMembers: (groupId: string) => rpc<Member[]>('list_members', { p_group_id: groupId }),
  setRole: (groupId: string, userId: string, role: Role) =>
    rpc('set_member_role', { p_group_id: groupId, p_user_id: userId, p_role: role }),
  createInvite: (groupId: string, days = 30, maxUses = 200) =>
    rpc<{ id: string; token: string; expires_at: string; max_uses: number }>('create_invite',
      { p_group_id: groupId, p_valid_days: days, p_max_uses: maxUses }),
  revokeInvite: (id: string) => rpc('revoke_invite', { p_invite_id: id }),
  listInvites: (groupId: string) => rpc<Invite[]>('list_invites_detail', { p_group_id: groupId }),
  getInviteLink: (inviteId: string) => rpc<{ token: string }>('get_invite_link', { p_invite_id: inviteId }),
  listGameLinkJoins: (groupId: string) => rpc<GameLinkJoin[]>('list_game_link_joins', { p_group_id: groupId }),
  listPendingSignups: (groupId: string) => rpc<PendingSignup[]>('list_pending_signups', { p_group_id: groupId }),
  dismissPendingSignup: (groupId: string, userId: string) =>
    rpc('dismiss_pending_signup', { p_group_id: groupId, p_user_id: userId }),
  /** FR-017: cached forecast for a game (never calls the weather provider). */
  getWeather: (gameId: string) => rpc<WeatherResponse>('get_game_weather', { p_game_id: gameId }),
  saveWeatherVenue: (gameId: string, address: string, latitude: number, longitude: number) =>
    rpc<{ id: string; address: string }>('save_weather_venue', { p_game_id: gameId, p_address: address, p_latitude: latitude, p_longitude: longitude }),
  removeWeatherVenue: (gameId: string) => rpc<boolean>('remove_weather_venue', { p_game_id: gameId }),
  /** Admin-only; the Edge Function looks up the address server-side, so the browser never sees it. */
  resendVerification: async (groupId: string, userId: string) => {
    const { data, error } = await supabase.functions.invoke('admin-resend-verification',
      { body: { group_id: groupId, user_id: userId } })
    if (error) {
      // FunctionsHttpError carries the response; surface the server's machine-readable code.
      const ctx = (error as { context?: Response }).context
      let code = ''
      try { code = (await ctx?.json())?.error ?? '' } catch { /* not JSON */ }
      throw new Error(code || error.message)
    }
    return data as { sent: true }
  },
}

export const isOrganiser = (r: Role | undefined) => r === 'organiser' || r === 'admin'
