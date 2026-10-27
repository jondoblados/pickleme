# PickleMe feature requests

Tracks requested features and their status. When a feature ships, its status changes to **Implemented** with the
version and date, and the details go in `changelog.md`.

**Process:** new feature ideas raised by Jon or in discussion are added here only after Jon confirms.

Status key: **Requested** · **In progress** · **Implemented** · **Declined**

## Summary

| ID | Feature | Status | Requested | Implemented |
|---|---|---|---|---|
| FR-001 | Create group | Requested | 2026-10-19 | — |
| FR-002 | Group switcher | Requested | 2026-10-19 | — |
| FR-003 | Group-aware invites and game links | Requested | 2026-10-19 | — |
| FR-004 | Promotion emails | Implemented (v0.2.0, live) | 2026-10-19 | 2026-10-19 |
| FR-005 | Sign-in CAPTCHA | Requested | 2026-10-19 | — |
| FR-006 | Join group and game from a shared game link | Implemented (v0.3.0) | 2026-10-23 | 2026-10-23 |
| FR-007 | Attendance tracking and no-show reports | Implemented (v0.3.0) | 2026-10-23 | 2026-10-23 |
| FR-008 | Late sign-ups while places are free | Implemented (v0.4.0) | 2026-10-23 | 2026-10-23 |
| FR-009 | Re-copy invite links; who joined with each link | Implemented (v0.5.0) | 2026-10-23 | 2026-10-23 |
| FR-010 | Admins can delete cancelled games | Implemented (v0.6.0) | 2026-10-23 | 2026-10-23 |
| FR-011 | Admins can rename the group | Implemented (v0.7.0) | 2026-10-23 | 2026-10-23 |
| FR-012 | WhatsApp roster image sharing | Implemented | 2026-10-24 | 2026-10-25 |
| FR-013 | Admin-only activity log | Implemented | 2026-10-26 | 2026-10-26 |
| FR-014 | 6-digit sign-in code in the sign-in email | Implemented (v0.8.0, live) | 2026-10-27 | 2026-10-27 |
| FR-015 | Admins see unconfirmed sign-ups and resend confirmation | Implemented (v0.9.0, live) | 2026-10-27 | 2026-10-27 |

## Details

### FR-001 — Create group
- **Status:** Requested
- **Requested:** 2026-10-19 by Jon
- **Description:** Admins can create a new group from the app by giving it a name, default player limit and timezone.
  The person who creates it becomes that group's admin.
- **Notes:** The database already supports multiple groups; this needs a secure `create_group` function and a form in the app.
  Decide who may create groups (e.g. only existing admins).

### FR-002 — Group switcher
- **Status:** Requested
- **Requested:** 2026-10-19 by Jon
- **Description:** A group picker in the header that remembers the last group you used. The games list, New game and
  Members & invites all follow the selected group. Players in several groups can also see a combined "My games" list
  with each game labelled by group.
- **Notes:** Today the app always uses the user's first group (`me.groups[0]`).

### FR-003 — Group-aware invites and game links
- **Status:** Requested
- **Requested:** 2026-10-19 by Jon
- **Description:** Invite links add players to the correct group (already true in the database), and opening a game link
  from another group switches the app to that group automatically.
- **Notes:** Depends on FR-002.

### FR-004 — Promotion emails
- **Status:** Implemented in v0.2.0 (2026-10-19). Live since `RESEND_API_KEY` was added; verified end to end.
- **Requested:** 2026-10-19 by Jon (priority: high)
- **Description:** When a waitlisted player moves into the playing list (because someone withdrew, an organiser removed
  a player, or the player limit was raised), email them automatically with the game details and a link to the game.
- **Notes:** Phase 7 of the implementation plan. The database already records promotions in `notification_outbox`.
  Sent via Resend from `pickleme.doblados.net`; deduplicated, retried with backoff, and skipped if the player is no longer
  playing or the game was cancelled by the time the email goes out.

### FR-005 — Sign-in CAPTCHA
- **Status:** Requested
- **Requested:** 2026-10-19 by Jon
- **Description:** Add a bot check (e.g. Cloudflare Turnstile or hCaptcha via Supabase Auth) to the sign-in form so
  automated requests can't use up the sign-in email allowance.
- **Notes:** Recommended before wider rollout beyond the first group.

### FR-006 — Join group and game from a shared game link
- **Status:** Implemented in v0.3.0 (2026-10-23).
- **Requested:** 2026-10-23 by Jon
- **Description:** A new user who opens a game link shared in WhatsApp can register with their email, choose a display
  name and, with one tap, join the game's group and the game (playing list or waitlist, depending on capacity).
- **Notes:** A game link now acts as an invitation to its group (forwarded links included). Requires a verified email.
  Membership and sign-up happen in one transaction, reusing the existing queue so capacity, order and duplicate
  protection are unchanged. Overlaps with FR-003 for the case of a game from a group the user isn't in yet.

### FR-007 — Attendance tracking and no-show reports
- **Status:** Implemented in v0.3.0 (2026-10-23).
- **Requested:** 2026-10-23 by Jon
- **Description:** Organisers and admins mark players Present, No-show or Excused, and generate attendance and repeat
  no-show reports with CSV export.
- **Notes:** Expected players are the playing list at start time. No-show only after the game ends. Changes are audited.
  Games that started before the release have no attendance records.

### FR-008 — Late sign-ups while places are free
- **Status:** Implemented in v0.4.0 (2026-10-23).
- **Requested:** 2026-10-23 by Jon
- **Description:** Allow sign-ups after a game starts (all games) while a playing place is free, until the game ends.
- **Notes:** No waitlist after the start. Late joiners start as Unmarked in attendance and are processed like
  everyone else at the end. Registration already stops at the end time (join and withdraw are blocked).

### FR-009 — Re-copy invite links; who joined with each link
- **Status:** Implemented in v0.5.0 (2026-10-23).
- **Requested:** 2026-10-23 by Jon
- **Description:** Admins and organisers can copy active invite links again, and see who joined with each link and
  who joined from a game link.
- **Notes:** Links created before v0.5.0 cannot be re-copied (hash only). Inactive links cannot be copied.

### FR-010 — Admins can delete cancelled games
- **Status:** Implemented in v0.6.0 (2026-10-23).
- **Requested:** 2026-10-23 by Jon
- **Description:** A Delete game button on cancelled games, for group admins only (not organisers).
- **Notes:** Permanent; removes sign-ups and history for that game. A group-level log entry records the deletion.

### FR-011 — Admins can rename the group
- **Status:** Implemented in v0.7.0 (2026-10-23).
- **Requested:** 2026-10-23 by Jon
- **Description:** Group admins can change the group name from Members & invites. Organisers and players cannot.
- **Notes:** 1–80 characters; renames are logged with the old and new names. Links are unaffected.

### FR-012 — WhatsApp roster image sharing
- **Status:** Implemented (PRs #1–#3, merged 2026-10-24 to 2026-10-25).
- **Requested:** 2026-10-24 by Jon
- **Description:** Generate a branded PNG showing the game details, Playing roster and ordered Waitlist, so WhatsApp
  group members can see who has signed up before opening the game link.
- **Layout:** Four columns by four rows for a 16-player game, with available places labelled; four columns by two rows
  for the first eight waitlist slots below. Number entries left-to-right, then top-to-bottom. Expand rows for other
  capacities or more than eight waitlisted players rather than omitting names.
- **Sharing:** Preview, share through the device share sheet where supported, and download PNG as a fallback. Keep the
  existing copyable WhatsApp message and clickable game link for the caption; test image/caption handling on mobile
  and WhatsApp Web before release.
- **Freshness:** Fetch the latest authorised roster before generation and include a snapshot timestamp with timezone.
  Clearly state that the shared image does not update and the game link has the latest list.
- **Privacy:** Initially organiser/admin-only generation. Include display names, signup positions and counts only;
  exclude email addresses, attendance/no-show information, personal YOU labels and admin controls. Warn that images
  can be forwarded. Prefer browser-side generation without publicly hosted roster images.
- **Prototype:** A sample PNG based on Jon's supplied screenshot was generated on 2026-10-24, with 10 players, six
  available places and an empty waitlist. It was labelled Test preview, not connected to live roster data or app code.

### FR-013 — Admin-only activity log
- **Status:** Implemented (PR #4, merged 2026-10-26).
- **Fix (v0.9.1):** group-link joins now record the joiner's name (the invite is redeemed after the first name is saved; `set_display_name` fills earlier unnamed rows by user ID). The log labels self actions, member actions and system actions; waitlist promotions are system actions with `triggered_by`. Existing rows repaired by user ID with the current profile name, marked as such.
- **Requested:** 2026-10-26 by Jon
- **Description:** An admin-only Activity log screen showing player joins, withdrawals and organiser removals, plus
  game creation, edits, registration closing/reopening, cancellation and deletion. Reuse existing audit events.
- **Display:** Show event date/time in the group's timezone, the actor, action, affected player when applicable,
  game and recorded details. Clearly distinguish a player's withdrawal from an organiser removing that player.
- **Browsing:** Newest-first pagination, filters by date range, game, actor/affected player and action, with CSV export.
- **Access:** Group admins only, enforced by database policies and the query function as well as the UI. Remove the
  existing organiser read access to raw audit events; deny players, organisers and admins of other groups. Review
  dependent invite-history functions so their intended access is not accidentally broken or used to expose the log.
- **Edit history:** Record field-level previous/new values for future game edits, including title, date/time, location,
  capacity and notes. Do not invent historical values or positions that were not logged.
- **Deleted games:** Preserve future game audit history when a game is permanently deleted, with enough game context
  to understand retained entries. Existing cascade-deleted records cannot be recovered by this feature.
- **Integrity and retention:** Read-only in the app; no editing/deleting individual events. Preserve useful attribution
  when names change or accounts are deleted, while respecting the app's retention/anonymisation policy. Do not expose
  auth tokens, invite secrets or unnecessary personal data in log responses or exports.
- **Acceptance:** Test direct API/table access for all roles and cross-group isolation, filter/pagination/export
  correctness, before/after edit details, deleted-game history and clear handling of incomplete historical records.

### FR-014 — 6-digit sign-in code
- **Status:** Implemented (v0.8.0, live 2026-10-27).
- **Requested:** 2026-10-27 by Jon, after a player kept being asked for her email when opening game links from WhatsApp.
- **Problem:** WhatsApp and mail apps on iOS open links in their own in-app browsers, each with separate storage. Tapping the
  email link signs the player in to the mail app's browser, not the one WhatsApp opens.
- **Description:** Sign-in emails (Magic Link and Confirm signup templates) show a 6-digit code (`{{ .Token }}`) alongside the
  existing button. The sign-in screen offers a code box after sending, verifying with `verifyOtp({ email, token, type: 'email' })`
  in the same browser. The "code sent" state survives a reload or app switch for up to an hour.
- **Configuration:** Supabase Auth → Email OTP length must be 6 (the UI accepts 6–10 digits to be safe).

### FR-015 — Unconfirmed sign-ups for admins
- **Status:** Implemented (v0.9.0, live 2026-10-27).
- **Requested:** 2026-10-27 by Jon.
- **Design:** The sign-in screen sends `pm_pending_game` or `pm_pending_invite_hash` (SHA-256 of the invite token) as user metadata,
  stored by Supabase only for new accounts. `list_pending_signups` (admin-only) returns unconfirmed, non-dismissed accounts from the
  last 30 days attributed to that group, with `private.mask_email` (first 1–2 characters and the domain). The `admin-resend-verification`
  Edge Function calls `claim_verification_resend` as the admin (authorisation, 10-minute limit, audit `verification_resent`), looks up
  the address with the service role and calls `auth.resend({ type: 'signup' })`. `list_members` adds `email_confirmed` for admins only.
- **Privacy:** Privacy policy and FAQ updated to describe the masked address shown to admins.
- **Description:** Admins see people who requested sign-in from their group's game or invite link but haven't confirmed their
  email, with a partly hidden email address, and can send a fresh confirmation email. Members with an unconfirmed email get a
  **Not confirmed** badge. Admin-only, enforced in the database. The full email is never sent to the browser.
