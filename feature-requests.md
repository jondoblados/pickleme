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
