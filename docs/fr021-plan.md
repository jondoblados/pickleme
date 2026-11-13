# FR-021 implementation plan — scheduled visibility, court booking fees, game-day slot confirmation

Status: in progress (draft PR). Decisions confirmed 2026-11-13 (see the spec). Not applied to production until Jon approves.
Spec: [feature-requests/FR-021-scheduled-games-fees.md](../feature-requests/FR-021-scheduled-games-fees.md).
Mockups: [docs/fr021-review/](fr021-review/) (PNG, with HTML sources in `source/`).

Courts and facilities are booked outside PickleMe. This plan doesn't add booking, provider integration or payments.

## 1. Database (migration `20261113000018_scheduled_games_fees.sql`)

### Visibility

- `games.visibility` — `'now' | 'week_before' | 'two_weeks_before'`, default `'now'`.
- `games.visible_from timestamptz` — generated from `starts_at` and `visibility`
  (`starts_at - 7 days` / `- 14 days`; `null` for `now`). Changing the start time moves it automatically.
- `private.game_visible(g)` — `visible_from is null or visible_from <= now()`. Being time-based means no job is needed
  to publish a game.
- **Row-level security:** today `games_read` lets any group member read every game. Replace it with
  `is_member(group_id) and (game_visible or has_role(group_id, organiser/admin))`. Apply the same rule to
  `registrations_read` and any table keyed by game (weather, attendance views).
- Update every function that returns or acts on a game for players — `get_game`, `list_games`, `join_game`,
  `preview_shared_game`, `join_shared_game`, invite redemption and attendance views — to return "not found" for
  hidden games, so a link reveals nothing.
- `update_game`: block switching a visible game back to hidden if any player (non-organiser) has joined.

### Fees

- `games.fee_total_cents int` (null = free, 1–999,999), `games.fee_currency char(3) default 'SGD'`, `games.fee_updated_at`.
- New table `game_payees` (one row per paid game): `payee_kind` (`organiser` | `nominated`), `payee_name`,
  `payee_mobile` (`+65` mobile, since PayNow uses Singapore numbers). RLS: readable by organisers/admins and by
  members with an active playing registration in that game; writable by organisers/admins.
- `set_game_fee(game_id, total_cents, currency, payee_kind, payee_name, payee_mobile)` — organiser/admin only; `null`
  total removes the fee. Writes an activity-log entry with the old and new totals (no numbers).
- `get_game` / `list_games` return `fee_total_cents`, `fee_currency`, `playing_count`, `share_cents` (rounded up to
  the cent), `share_if_full_cents`, and `fee_changed_since_join` for the caller.
- **Final share:** `games.playing_at_start` snapshots the playing list when the game starts (set by the existing
  attendance trigger or on first read after `starts_at`). Final share = total ÷ (snapshot − players marked `excused`
  in `game_attendance`); unexcused no-shows count. `share_is_final` is true once every snapshot player is marked.

### Slot confirmation

- New table `slot_confirmations` (`game_id`, `user_id`, `mobile`, `confirmed_at`, `recorded_by`), unique per game and user.
  `mobile` is stored in international (E.164) format, `+` then 8–15 digits, any country code, as used by WhatsApp.
  RLS: select for organisers/admins of the group only. Players can't read rows, including their own; the API tells
  them only whether they've confirmed.
- `confirm_slot(game_id, mobile)` — allowed only if the game has a fee, the caller is playing (not waitlisted), and
  the time is between 00:00 on the game date (group time zone) and the start time.
- `list_slot_confirmations(game_id)` — organiser/admin only; returns confirmed and pending playing members.
- Weekly `pg_cron` job (same pattern as avatar cleanup) deletes confirmations 30 days after the game ends.
- Activity log records "Confirmed slot" without the number.

## 2. App (React)

| Screen | Change |
|---|---|
| `GameForm.tsx` | "When should players see this game?" radio with computed date/time; optional **Court booking fee** section with payee choice. Copying the last game also copies visibility, fee and payee. |
| `Home.tsx` games list | Cost line on cards; amber **Hidden until …** chip for organisers/admins. |
| `GamePage.tsx` | Fee card (total, split, share if full); **Pay your share** card with payee and copy-number button for playing members; fee-changed notice; **Confirm your slot** card on the game day; organiser **Slot confirmations** panel next to attendance. |
| Shared-game preview | Cost line and "By joining, you agree to pay your share to the organiser." |
| `RosterImageShare.tsx`, WhatsApp text | One cost line; never payee or confirmation numbers. |
| `InfoPages.tsx` | Privacy policy (mobile numbers: purpose, who sees them, 30-day deletion) and FAQ (scheduling, fees, confirming). |

Shared helpers in `src/lib/fees.js` (estimated and final share, SGD formatting, international mobile validation with a
country-code picker defaulting to `+65`, and the `+65` PayNow payee check) with tests.

## 3. Emails

- `send-promotions` template: add the cost line when the game has a fee.
- No new emails in the first release (see the spec's proposed defaults).

## 4. Tests

- `supabase/tests/scheduled_games_fees.sql`:
  - a player can't select, list, preview, join or redeem a link to a hidden game; an organiser/admin can;
  - the game becomes visible at `visible_from` with no action;
  - changing `starts_at` moves `visible_from`;
  - fee and share maths (0 players, waitlist excluded, rounding up, promotion from the waitlist);
  - final share: excused players excluded, unexcused no-shows included, late sign-ups after the start not in the snapshot;
  - payee visible to playing members only;
  - confirmation rules (00:00 to start time, paid games only, playing only), numbers with various country codes,
    and organiser-only reads;
  - 30-day deletion.
- `tests/fees.test.mjs` for helpers; roster-image test with a cost line; review harness for the new cards.
- Regression: existing acceptance suite passes for free, visible games.

## 5. Rollout

1. Decisions confirmed 2026-11-13. Jon approves the build.
2. Branch `feature/fr021-scheduled-games-fees`; migration and tests first, then UI.
3. Draft PR with screenshots; Jon reviews before merge.
4. Apply the migration to production, deploy, and check on a real phone (hidden game, fee lines, WhatsApp text,
   slot confirmation).
5. Release as v0.14.0; update `changelog.md` and mark FR-021 implemented.

## Risks

- **Leaking hidden games:** the main risk, because direct table reads are allowed today. Mitigated by RLS plus
  function checks and tests for every entry point.
- **Moving share amounts:** the share changes with sign-ups; the UI always labels it "about" and gives the split basis.
- **Personal data:** new mobile numbers. Kept per game, organiser/admin-only, excluded from logs and shares, and
  deleted after 30 days.

## Build notes (draft PR, 2026-11-13)

How the build interprets or extends the spec. Flagged for review in the pull request.

- **Late joiners pay too.** The final share is the total divided by everyone on the attendance list (the playing list
  at the start time plus anyone added late, FR-008), minus players marked Excused. Unexcused no-shows still pay.
- **Hidden games are enforced in the database.** The existing `get_game`, `list_games`, `preview_shared_game`,
  `join_game`, `join_shared_game`, `get_game_weather` and `claim_promotion_emails` functions move to the private schema
  and are wrapped by public functions with the same signatures that apply the visibility check first. Row-level security
  on games and registrations uses the same check.
- **No direct table access** to `game_payees` (PayNow payee) or `slot_confirmations`; both are read and written only
  through functions.
- **Mobile numbers.** Confirmation numbers are chosen with a country picker (+65 first) or typed in full starting with
  `+` or `00`; bare digits without a country code are rejected. The PayNow payee must be a Singapore mobile (+65,
  starting with 8 or 9); a local 8-digit number is accepted as +65.
- **Repeat games.** A new game copies the fee, payee and visibility of the group's last game, like title and location.
  The organiser's own PayNow number is remembered on their device.
- **Policy date.** The privacy policy shows "Last updated 13 November 2026"; adjust it to the release date.
