# Changelog

All notable work on PickleMe, newest first. Phases refer to the PickleMe Implementation Plan (18 Oct 2026).

## [0.2.1] — 2026-10-20 — Privacy notice, Privacy Policy and FAQ

### Added
- Short privacy notice under the "Email me a sign-in link" button on the sign-in screen, linking to the Privacy Policy
  (PDPA notification at the point of collection).
- Privacy Policy page (`?view=privacy`), tailored to how PickleMe actually works: Supabase, Resend, GitHub Pages and
  Google Fonts as providers; emails not visible to anyone in the app; no analytics or ad trackers; contact jon@doblados.net.
- FAQ & guide page (`?view=faq`) that doubles as a user guide: signing in, joining, waitlist, withdrawing, sharing,
  organiser tasks and privacy.
- Footer with "FAQ & guide" and "Privacy Policy" links on every screen (sign-in, onboarding and the signed-in app).
  Both pages are public, and opening them keeps any invite or game link parameters so nothing is lost on the way back.

### Follow-ups
- [ ] The policy commits to deleting or anonymising identifiable sign-up records 12 months after a game; a scheduled
  clean-up job still needs to be built.
- [ ] Account deletion is by email request for now; self-service deletion not yet built.

## [0.2.0] — 2026-10-19 — Promotion emails (FR-004, Phase 7)

### Added
- Added FR-004 Promotion emails and FR-005 Sign-in CAPTCHA to `feature-requests.md`; FR-004 now Implemented.
- Migration `20261019000004_promotion_emails.sql`:
  - `notification_outbox` gains `status` (pending/sending/sent/skipped/failed), `claimed_at`, `next_attempt_at`,
    `provider_message_id`, `skipped_reason`.
  - Enabled `pg_net` and `pg_cron`. A statement trigger on the outbox calls the Edge Function right after a promotion
    commits; a cron job every 2 minutes retries anything due.
  - Shared secret and function URL stored in Supabase Vault; database ↔ function calls are authenticated with it.
  - `claim_promotion_emails` (row locking with SKIP LOCKED, max 50 per run), `complete_promotion_email` (sent, or retry with
    2/4/8/16-minute backoff, failed after 5 attempts), `release_promotion_emails` (return rows without using an attempt).
  - Eligibility re-checked at send time: skipped if the player withdrew, is no longer in the playing list, the game was
    cancelled, or the game has finished.
- Edge Function `send-promotions` (Deno): sends one email per promotion through the Resend API from
  `PickleMe <games@pickleme.doblados.net>`, with an idempotency key per promotion so retries never send twice.
  Email includes name, game, date, time, location, playing-list position, "View the game" link and a reminder to withdraw
  if they can't make it. If `RESEND_API_KEY` is missing it releases rows and returns 503 (nothing is lost).
- Waitlist message in the app now says "…and we'll email you."
- `supabase/tests/promotion_emails.sql`: 12 checks, all passing (claim, sent, no duplicates, skip after withdrawal,
  backoff, re-claim, release, cancelled game, wrong secret, players can't read the outbox, trigger fires).
- Verified live: function rejects missing/wrong secret (401/403); database → function call works and reports
  "RESEND_API_KEY not configured" until the secret is added.
- Confirmed Resend DNS records for `pickleme.doblados.net` and DMARC for doblados.net are published.

### Verified live (2026-10-19)
- Jon added `RESEND_API_KEY`. End-to-end test with Resend test inboxes (game with 1 spot; player 1 withdrew):
  the waitlisted player's email was sent through Resend about 2 seconds after the withdrawal (status `sent`, 1 attempt,
  Resend message ID recorded). Test accounts and game deleted afterwards; real games and members untouched.

## Unreleased (folded into 0.2.0)

- Added `feature-requests.md` to track requested features (FR-001 Create group, FR-002 Group switcher,
  FR-003 Group-aware invites and game links).

## [0.1.2] — 2026-10-19 — Email delivery plan

- Checked doblados.net DNS: hosted at Moniker; root MX/SPF belong to Google Workspace; `mail.doblados.net` is a Google CNAME;
  no DMARC record yet.
- Chose a dedicated sending subdomain `pickleme.doblados.net` (Resend region Tokyo) so Workspace email is unaffected.
- Added `docs/resend-setup.md` with the Resend, Moniker DNS and Supabase SMTP steps.

## [0.1.1] — 2026-10-19 — Sign-in troubleshooting

### Found
- First sign-in links redirected to `http://localhost:3000` because the Supabase Auth Site URL / Redirect URLs were still at defaults.
- Further requests then failed with `429 over_email_send_rate_limit`: Supabase's built-in sender allows only 2 emails per hour
  per project (both were used at 16:03 and 16:06 UTC on 18 Oct). The built-in sender also only delivers to Supabase team-member
  addresses, so `jon@doblados.net` may not receive mail until custom SMTP (Resend) is configured.

### Changed
- Sign-in error messages now distinguish the hourly email limit ("try again in about an hour"), the 60-second per-address
  cooldown, and general request throttling (previously all showed "wait a minute").
- Made `jon.doblados@gmail.com` (Jon's existing account, created during the first sign-in) an admin of Tuesday Socials @CBP1,
  and added it to `private.bootstrap_admins`. `jon@doblados.net` remains a bootstrap admin too.

## [0.1.0] — 2026-10-19 — Pilot-ready core (Phases 1–6)

### Decisions (confirmed with Jon)
- Hosting: new public repo `jondoblados/pickleme`, published as a GitHub Pages project site at `https://jon.doblados.net/pickleme/`
  (same pattern as the existing `poc` repo; the main `jondoblados.github.io` site is untouched).
- Backend: Supabase project `pickleme` (ref `bzxkbulljurizjrpixdm`), region `ap-southeast-1` (Singapore), org "Dobi", $0/month plan.
- Email provider: Resend (custom SMTP) — setup pending, see "Open items".
- First group: **Tuesday Socials @CBP1**, default capacity 16, timezone Asia/Singapore.
- Organisers: Jon, Mario, Shawn, CK, WS. `jon@doblados.net` becomes admin automatically on first sign-in; Jon then promotes
  the others to Organiser from the Members page after they join.

### Phase 1 — Foundation
- Investigated existing GitHub Pages setup: `jondoblados.github.io` (legacy build, CNAME `jon.doblados.net`) and `poc`
  (Actions-based project site at `/poc/`). Confirmed `/pickleme/` was free (404) with no conflicting folder.
- Scaffolded React 19 + TypeScript + Vite 8 app with `base: '/pickleme/'`.
- Added `.github/workflows/deploy.yml` (build → upload-pages-artifact → deploy-pages), with actions pinned to commit SHAs
  matching the `poc` repo convention.
- Versioned all database changes in `supabase/migrations/`.

### Phase 2 — Authentication
- Passwordless email magic links via `signInWithOtp`, implicit flow so links work when the email opens in a different browser
  from the WhatsApp in-app browser.
- Destination (game / invite) is carried inside the link's redirect URL and validated against an allow-list (no open redirects).
- Optional custom template (`supabase/templates/magic_link.html`) uses a token hash plus a "Continue" button page, so email
  link scanners cannot consume the one-time link.
- Clear handling for expired/used links, 60-second resend cooldown, sign-out, first-run display-name onboarding.
- Invite links: organisers create a link (30 days, up to 200 uses); only a SHA-256 hash of the token is stored; links can be turned off.

### Phase 3 — Signup engine (database)
- Tables: `profiles`, `groups`, `group_members`, `group_invites`, `games`, `registrations`, `audit_events`,
  `notification_outbox`, plus server-only `private.bootstrap_admins`.
- RLS on every table; clients have SELECT only, all writes go through `security definer` functions with a fixed `search_path`
  and explicit role checks. Anonymous users have no access.
- Queue: immutable database-assigned `queue_no` per game; positions 1–capacity = playing, the rest = waitlist.
  Every signup-changing function locks the game row (`SELECT … FOR UPDATE`).
- Functions: `join_game`, `withdraw_game`, `remove_registration`, `create_game`, `update_game`, `set_game_status`,
  `get_game`, `list_games`, `get_me`, `set_display_name`, `create_invite`, `revoke_invite`, `redeem_invite`,
  `list_members`, `set_member_role`.
- Rules: one active registration per player per game; rejoin goes to the end; closing registration blocks joins but allows
  withdrawals; joins blocked after start; capacity can't drop below confirmed players; cancelling is permanent.
- Promotions (from withdrawals, removals or capacity increases) are written to `notification_outbox` (deduplicated) ready for Phase 7.
- Realtime enabled for `registrations` and `games`.

### Phase 4 — Player interface
- Mobile-first UI: games list with fill meter and personal status chip; game page with "You're playing — #n" / "Waitlist — #n",
  numbered Playing and Waitlist lists, Join / Join waitlist, two-tap Withdraw.
- Live updates via Supabase Realtime, plus refetch on tab focus, reconnect and after every action (the server is always the
  source of truth).
- Share: Copy game link, Copy WhatsApp message, Open in WhatsApp.

### Phase 5 — Organiser interface
- Create game (pre-filled from the last game + 7 days, else next Tuesday 7–9 pm @ CBP1, 16 players), edit game, close/reopen
  registration, cancel game, remove a player (two-tap confirm).
- Members & invites page: create/copy/share/turn off invite links; admin can set member roles (Player / Organiser / Admin).

### Phase 6 — Testing & hardening
- `supabase/tests/acceptance.sql`: 25 database checks, all passing — 16 playing + waitlist #1/#2, double-tap join, withdraw
  promotes next, waitlist closes up, rejoin at end, non-member blocked (RPC and RLS), player can't remove others or
  self-promote, direct table writes denied, no emails in roster, capacity rules, organiser removal, closed registration, bad invite.
- Browser QA (Playwright, 375 px and 1280 px) against the live database with temporary accounts: onboarding, create game,
  join, waitlist, live update across sessions, withdrawal promotion, invite redemption, non-member screen, expired-link handling.
- Concurrency check: simultaneous joins for the last place — exactly one player got it, the other became waitlist #1, no duplicates.
- Security advisor: only expected notices (intentional authenticated RPCs; outbox has no client policy by design).
- All QA accounts and test data removed afterwards.

### Open items
- [ ] Jon: set Supabase Auth Site URL and Redirect URLs (see README).
- [ ] Jon: create Resend account, verify a sending domain (DNS records for doblados.net), and enter SMTP settings in Supabase.
- [ ] Jon: paste the custom Magic Link / Confirm signup template (recommended).
- [ ] Jon: sign in first as `jon@doblados.net`, create the invite link, share it, then promote Mario, Shawn, CK and WS to Organiser.
- [ ] Phase 7: promotion-email worker (Edge Function reading `notification_outbox`, sending via Resend, retries) — after Resend is set up.
- [ ] Consider CAPTCHA on sign-in before wider rollout.
