const MESSAGES: Record<string, string> = {
  not_signed_in: 'Please sign in again.',
  not_member: 'You are not a member of this group yet. Ask an organiser for the group invite link.',
  forbidden: 'Only organisers can do that.',
  game_not_found: 'That game no longer exists.',
  game_cancelled: 'This game has been cancelled.',
  registration_closed: 'Registration is closed for this game.',
  game_started: 'This game has already started, so new sign-ups are closed.',
  game_finished: 'This game has finished.',
  not_registered: 'You are not on the list for this game.',
  display_name_required: 'Please choose a display name first.',
  invalid_display_name: 'Display names must be 1–40 characters.',
  invalid_times: 'The end time must be after the start time.',
  capacity_below_attendees: 'Capacity cannot be lower than the number of players already confirmed.',
  invite_invalid: 'That invite link is not valid.',
  invite_revoked: 'That invite link has been turned off. Ask an organiser for a new one.',
  invite_expired: 'That invite link has expired. Ask an organiser for a new one.',
  invite_used_up: 'That invite link has reached its limit. Ask an organiser for a new one.',
  invalid_invite_settings: 'Invite settings are out of range.',
  cannot_change_own_role: 'You cannot change your own role.',
  member_not_found: 'That member was not found.',
}

export function friendlyError(e: unknown): string {
  const code = (e && typeof e === 'object' && 'code' in e) ? String((e as { code: unknown }).code) : ''
  if (code === 'over_email_send_rate_limit') {
    return 'PickleMe has reached its sign-in email limit for now. Please try again in about an hour, or ask an organiser.'
  }
  if (code === 'over_request_rate_limit') return 'Too many attempts from this device. Please wait a few minutes and try again.'
  const raw = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : String(e)
  if (MESSAGES[raw]) return MESSAGES[raw]
  if (/failed to fetch|network/i.test(raw)) return 'Connection problem — check your internet and try again. Nothing was changed.'
  if (/email rate limit/i.test(raw)) return 'PickleMe has reached its sign-in email limit for now. Please try again in about an hour, or ask an organiser.'
  if (/for security purposes|after \d+ seconds/i.test(raw)) return 'Please wait a minute before requesting another link.'
  if (/rate limit|too many/i.test(raw)) return 'Too many attempts. Please wait a few minutes and try again.'
  if (/expired|invalid.*(token|otp)|otp.*(expired|invalid)/i.test(raw)) return 'This sign-in link has expired or was already used. Request a new one below.'
  return raw || 'Something went wrong. Please try again.'
}
