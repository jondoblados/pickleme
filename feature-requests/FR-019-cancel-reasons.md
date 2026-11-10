# FR-019 — Required cancellation reason, shown as a note from the organiser

- Status: Implemented — v0.13.0, released 2026-11-10 (PR #11).
- Requested: 2026-11-10 by Jon, after cancelling the Tuesday game for rain.

## Requested behaviour

Organisers and admins must enter a reason when they cancel a game. Players see the reason as an information note
from the organiser or admin, rather than only a red "Cancelled" pill.

## Decisions (2026-11-10)

- **Pulldown reasons:** Rain / wet courts · Lightning risk · Venue unavailable · Not enough players ·
  Organiser unavailable · Other (type a reason). Choosing one fills in the note; the organiser can edit it before
  confirming. Choosing another preset replaces preset text but never overwrites custom text.
- **Validation:** a reason is required, 3–200 characters after trimming. Enforced by the database, so a game cannot be
  cancelled without one through any client. `set_game_status` no longer accepts `cancelled`; `cancel_game` does.
- **Display:**
  - Game page: blue information note, "Game cancelled", the reason, then "— Name (Admin/Organiser) · date, time",
    with "· edited" after a correction. The red pill is removed.
  - Games list: a blue "ⓘ Cancelled" label, with the reason under the location (up to two lines).
  - WhatsApp message: "CANCELLED: title", date, time, location, then "Note from Jon (Admin): reason".
  - Roster image and caption: a "GAME CANCELLED" information band with the note under the header.
- **Edits:** organisers and admins can edit the note (or add one to games cancelled before this release) with
  **Edit note** / **Add a reason**. Edits are recorded in the activity log with before and after values.
- **Older cancelled games:** no reason is invented; they show "No reason was given for this cancellation."
