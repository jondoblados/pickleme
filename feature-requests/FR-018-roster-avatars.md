# FR-018 — Roster image with avatar circles

- Status: Requested; not implemented.
- Requested: 2026-11-09 by Jon.
- Builds on: FR-012 (roster image sharing) and FR-016 (profile photos).

## Requested behaviour

Replace the table of rectangles in the generated roster image with avatar circles and names, laid out as a
three-column list.

- **Playing:** each signed-up player is an avatar circle with their name beside or under it, in signup order,
  numbered left to right then top to bottom, as today.
- **Free places:** each unfilled playing place is an empty avatar circle showing its number, e.g. `#10`, `#11`,
  so the number of free places is visible at a glance.
- **Waitlist:** waitlisted players and open waitlist places are avatar circles labelled `WL1`, `WL2`, and so on.
  Filled waitlist places show the player's avatar and name with the `WL` label; open ones show only the label.
- Keep everything else in the image: header (title, date, time, location), Playing count and Waitlist count,
  snapshot time with timezone, and the "image does not update" note.

## Proposed details (for review)

- **Avatar content:** initials on the colour already derived from the user ID (FR-016 fallback). FR-016 decided
  profile photos are visible to group members only and are not included in roster images, because the image is
  shared into WhatsApp. Using real photos here would change that decision and needs Jon's confirmation.
- **Visual distinction:** playing avatars solid; free places as dashed or outlined circles with `#n`; waitlist in
  the existing cream tone with a `WL` label so players can tell the sections apart without colour alone.
- **Section order:** Playing first, then a separate Waitlist group, or continue the same grid as today.
  To be decided on the mockup.
- **Waitlist placeholders:** the current image shows 8 waitlist places (W1–W8). Confirm whether to keep 8, show
  fewer (e.g. 3), or show only filled waitlist places plus the next open one.
- **Long names:** wrap to two lines, then truncate with an ellipsis; never drop a player.
- **Large rosters:** the image grows in height as today; no names omitted.

## Acceptance

- A 16-player game with 16 playing and 1 waitlisted shows 16 named avatars, `WL1` with the waitlisted name, and
  the agreed number of open `WL` placeholders.
- A game with free places shows `#n` circles for each free place, numbered after the last player.
- No profile photos appear unless Jon approves changing the FR-016 decision.
- Existing roster-image tests updated; mockup reviewed before implementation.
