# Changelog

All notable work on PickleMe, newest first. Phases refer to the PickleMe Implementation Plan (18 Oct 2026).

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
