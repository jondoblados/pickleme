# FR-021 — Scheduled game visibility, court booking fees and game-day slot confirmation

- Status: In progress (draft PR). Decisions confirmed 2026-11-13. Not applied to production.
- Requested: 2026-11-13 by Jon, for an organiser who has booked courts for every game in Q1 2027 and wants to enter
  all of them now.
- Plan: [docs/fr021-plan.md](../docs/fr021-plan.md). Mockups: [docs/fr021-review/](../docs/fr021-review/).

## Scope

Organisers book courts or facilities outside PickleMe. This feature lets them:

1. enter games well in advance and choose when players can see them;
2. record the total court booking fee for a game, now or later, and show players their share;
3. ask players in paid games to confirm their slot on the game day with a mobile number that only organisers and
   admins can see.

**Out of scope:** booking courts or facilities in PickleMe, connecting to any booking provider, taking or tracking
payments, PayNow QR codes, and repeat/bulk game creation (the existing form already copies the last game one week later).
Court and facility prebooking is a separate idea (FR-020, drafted on branch `docs/fr020-court-prebooking`).

## Requested behaviour

### 1. Scheduled visibility

- The game form has **When should players see this game?**
  - **Visible now** (default)
  - **1 week before** the start time
  - **2 weeks before** the start time
- The form shows the exact time, e.g. a game on Thu 14 Jan 2027 at 7:00 pm set to 2 weeks before becomes visible
  on Thu 31 Dec 2026 at 7:00 pm (group time zone).
- If the chosen time has already passed, the game is visible straight away and the form says so.
- Until it's visible, only the group's organisers and admins can see the game. Players can't find it in the games
  list, by its game link, through invite or shared-game links, or by reading the database directly. Nothing tells
  players a hidden game exists.
- Organisers can change the setting while editing a game. Once a game is visible, it can't be hidden again if anyone
  other than organisers has joined.
- Organisers see a **Hidden until …** label on scheduled games.

### 2. Court booking fee

- Optional. Games without a fee work exactly as today.
- Can be added, changed or removed when creating or editing a game, including after people have joined.
- Fields:
  - **Total fee for this game**, in SGD by default (0.01–9,999.99).
  - **Players pay by PayNow to:** the organiser (default; organiser enters their PayNow mobile number) or
    **another mobile number** (name and number), e.g. whoever booked the courts. Because PayNow uses Singapore
    numbers, the payee number is a `+65` mobile.
- **Estimated share** (before and during the game) = total fee ÷ current playing members (waitlisted players
  excluded), rounded up to the cent. With no playing members yet: "per player shown after sign-ups". The game page
  also shows the share if every place fills.
- **Final share** = total fee ÷ members on the playing list at the start time, minus those the organiser marks
  **Excused** (FR-007). No-shows who aren't excused still pay. The share is labelled "final" once attendance has been
  marked for everyone on the playing list; until then it stays an estimate.
- The payee name and PayNow number are shown only to members playing in that game, and to organisers and admins.
  PickleMe doesn't handle payments.

### 3. Cost shown wherever the game is published

Where a fee is set, the total and current per-player share appear on:

- the games list card and game page;
- the shared-game preview and **Join game** button ("By joining, you agree to pay your share to the organiser");
- the WhatsApp message and roster image ("Court fee: SGD 48.00 total · about SGD 6.00 each (8 playing; changes
  with sign-ups)");
- promotion emails from the waitlist.

Payee and confirmation numbers never appear in shared messages or images.

When a fee is added or changed after people have joined, the game page shows them a notice with the old and new amounts.

### 4. Game-day slot confirmation (paid games only)

- On the game date, from 00:00 in the group's time zone until the start time, each playing member sees
  **Confirm your slot for today** and enters a mobile number.
- Any country code is accepted, in the same international format WhatsApp uses: a country-code picker (default
  `+65`) and the number, stored as `+<country code><number>` (8–15 digits in total).
- The number is stored for that game only. It isn't saved to the profile or reused for other games.
- Only the group's organisers and admins can see it. It's not shown in member lists, rosters, shared messages,
  images or the activity log, and it's deleted 30 days after the game.
- Organisers see confirmed and pending players, with numbers, on the game page.
- Confirming a slot doesn't mark attendance or payment. Organisers still mark Present / No-show (FR-007).
  Unconfirmed players aren't removed automatically.

## Decisions (2026-11-13)

| # | Question | Decision |
|---|---|---|
| 1 | Who shares the final fee? | Everyone on the playing list at the start time, including no-shows, except players marked Excused. |
| 2 | Confirmation window | From 00:00 on the game date until the start time. |
| 3 | Telling players about a new or changed fee | In-app notice on the game page; no email in the first release. |
| 4 | Confirmation numbers | Visible only to organisers and admins; any country code in WhatsApp's international format; deleted 30 days after the game. |
| 5 | Currency | SGD only for now, stored with a currency code so others can be added later. |

## Acceptance criteria

1. A new game defaults to **Visible now**; behaviour is unchanged for games with no schedule and no fee.
2. A game scheduled for 2 weeks before can't be seen or joined by a player before its visibility time, through any
   screen, link or database call, and appears automatically at that time without an organiser action.
3. Organisers and admins can see, edit, cancel and delete hidden games.
4. A fee can be added to an existing game; the share updates as players join, withdraw or move up from the waitlist.
5. The cost line appears on every surface listed in section 3; payee and confirmation numbers never do.
6. Between 00:00 on the game date and the start time, a playing member of a paid game can confirm with a mobile
   number with any country code (e.g. `+65 9876 5432`, `+63 917 123 4567`); a waitlisted player, a non-member or a
   player in a free game can't, and confirmation closes at the start time.
7. The final share divides the fee among players on the playing list at the start time, excluding those marked
   Excused; unexcused no-shows are included.
8. Only organisers and admins of that group can read confirmation numbers; numbers are deleted 30 days after the game.
9. Privacy policy and FAQ are updated before release.

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
