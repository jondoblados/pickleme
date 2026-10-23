# Shared game onboarding and attendance — draft implementation

Status: Released in v0.3.0 (2026-10-23). Build passes; database acceptance tests in supabase/tests/game_access_attendance.sql pass (52/52) and existing acceptance.sql passes with the migration applied.

## Requested features
- FR-006: An existing WhatsApp game URL carries a new player through verified email sign-in, display-name setup, and a single Join group & game action. Membership and queue insertion are atomic.
- FR-007: Group admins and organisers record attendance and export per-game attendance, date-filtered group attendance, and repeat-no-show reports (default threshold 2).

## Access change
A game UUID is now a bearer invitation to join its group. Signed-in users can preview basic game details, but cannot see the roster until membership is granted. Joining adds the user to the group as a player and therefore grants the same group-wide visibility as existing group invites. Existing game links work without replacing WhatsApp messages. Forwarded links also work. This is an intentional change from invite-only membership and must be documented in the Privacy Policy and FAQ before release. If group-wide membership from forwarded game links is not desired, use a revocable, game-scoped invitation design instead.

## Attendance rules
- Attendance is separate from registration and never alters queue positions or sends promotion emails.
- Expected players are the first capacity registrations at game start, excluding pre-start withdrawals and all waitlist entries.
- Capture is lazy (first attendance view, or before a subsequent game/registration update), reconstructing start-time eligibility from join/cancellation timestamps and freezing it before capacity changes.
- Games already started when the migration runs are excluded: capacity-at-start was not versioned, so historical attendance cannot be reliably reconstructed.
- Post-start withdrawal does not erase expected attendance. Organisers can mark Excused instead of No-show.
- Unmarked is never counted as a no-show. Present/Excused can be recorded from game start; No-show only after game end. Corrections are permitted and audited.
- Reports exclude cancelled games, require a role in the target group, use group-local inclusive dates, and aggregate by immutable user ID rather than display name.
- Repeat no-show threshold defaults to 2 within the selected period. Reports display raw counts, not an implied no-show percentage over unreviewed records.
- Attendance refreshes every 30 seconds while visible, on focus, after writes, and manually. CSV protects against formula injection.

## Release checklist
1. Run npm ci and npm run build in an environment with Node and dependencies; no successful build is claimed here.
2. Apply migration to an isolated Supabase test project, not production; run permission/concurrency tests below.
3. Browser-test email opening outside WhatsApp, profile onboarding, group membership, and attendee/waitlist results.
4. Update main feature-requests.md and changelog.md after acceptance, not as Implemented before verification.
5. Update Privacy Policy/FAQ for game-link membership, organiser-only attendance, exports, correction requests, and retention. Extend the outstanding 12-month deletion/anonymisation job to attendance records and audit details before production.
6. Deploy database before frontend. Do not merge into main until the above passes; main deploys GitHub Pages.

## Required acceptance tests
- Fresh verified-email user opens game URL with no separate invite; profile and game context survive; joining creates one membership and one registration.
- Unverified/anonymous callers cannot join. Missing profile or closed/cancelled/started game rolls back membership.
- Simultaneous joins for final slot yield one attendee and one waitlisted player; repeated Join yields no duplicate.
- User already in another group can join the linked group; no role elevation; existing invite flow still works.
- Player and cross-group organiser cannot read, write, or export attendance through direct RPC calls. Direct table access is denied.
- Before start attendance is unavailable. Capture excludes waitlist and pre-start cancellation, retains post-start withdrawal, survives capacity updates, and is idempotent.
- No-show before end is rejected. Present -> No-show -> Excused correction changes totals and records each actor/time.
- Cancelled games are excluded from reports, including games cancelled after marking.
- Reports respect group-timezone date boundaries, group isolation, identical names with distinct user IDs, threshold, empty results, and malicious CSV formulas.
- Existing started games are not backfilled or labelled no-show.
