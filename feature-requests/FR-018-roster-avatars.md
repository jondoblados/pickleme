# FR-018 — Roster image with avatar circles

- Status: In progress — implementation on branch `feature/fr018-roster-avatars`, in review.
- Requested: 2026-11-09 by Jon.
- Builds on: FR-012 (roster image sharing) and FR-016 (profile photos).

## Requested behaviour

Replace the table of rectangles in the generated roster image with avatar circles and names, laid out as a
three-column list.

- **Playing:** each signed-up player is an avatar circle with their name beside or under it, in signup order,
  numbered left to right then top to bottom, as today.
- **Free places:** each unfilled playing place is an empty avatar circle showing its number, e.g. `#10`, `#11`,
  so the number of free places is visible at a glance.
- **Waitlist:** waitlisted players are avatar circles with a `WL1`, `WL2`, ... label, in waitlist order.
- Keep everything else in the image: header (title, date, time, location), Playing count and Waitlist count,
  snapshot time with timezone, and the "image does not update" note.

## Decisions (2026-11-09)

- **Avatars:** use the player's profile photo when they have set one, otherwise initials on their user-ID colour.
  This changes the FR-016 rule that photos are kept out of roster images, so the privacy policy and FAQ must be
  updated when this ships (the image is shared into WhatsApp, outside the group).
- **Waitlist:** show the Waitlist section only when at least one player is waitlisted, and show exactly the waitlisted
  players (`WL1`, `WL2`, ...) with no open waitlist placeholders: 2 waitlisted shows 2, 10 waitlisted shows all 10.
- **Header:** show the PickleMe pickleball icon beside the PickleMe wordmark in the image header, styled like the app header: Bricolage Grotesque 800, "Pickle" in white and "Me" in ball lime (#d9f24a).
- **Layout:** separate Playing and Waitlist sections, each a three-column list. Mockup:
  `mockups/fr018-review/` in the project files.

## Proposed details (for review)

- **Visual distinction:** playing avatars solid; free places as dashed or outlined circles with `#n`; waitlist in
  the existing cream tone with a `WL` label so players can tell the sections apart without colour alone.
- **Numbering:** players carry a small number badge (1, 2, ...); open places show `#n` inside a dashed circle with
  "Open"; waitlisted players carry an amber `WL1` badge.
- **Photos in the image:** drawn from the signed URL at generation time; if a photo fails to load, fall back to initials
  rather than failing the image.
- **Long names:** wrap to two lines, then truncate with an ellipsis; never drop a player.
- **Large rosters:** the image grows in height as today; no names omitted.

## Acceptance

- A 16-player game with 16 playing and 2 waitlisted shows 16 named avatars and a Waitlist section with exactly
  `WL1` and `WL2`; with 10 waitlisted, all 10 appear and the image grows in height.
- The header shows the pickleball icon beside the PickleMe wordmark.
- A game with nobody waitlisted has no Waitlist section.
- A game with free places shows `#n` circles for each free place, numbered after the last player.
- Players with a profile photo appear with it; others with initials. Privacy policy and FAQ updated.
- Existing roster-image tests updated; mockup reviewed before implementation.
