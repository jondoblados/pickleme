# FR-020 — Court and facility prebooking

- Status: Requested — mockups and implementation plan ready for review (2026-11-13). No code or database changes yet.
- Requested: 2026-11-13 by Jon.
- Builds on: FR-007 (roles and attendance), FR-017 (venues and weather), FR-019 (cancellation reasons),
  FR-004 (email outbox). Related: FR-001–FR-003 (multi-group support).
- Plan: [docs/fr020-court-prebooking-plan.md](../docs/fr020-court-prebooking-plan.md)
- Mockups: [docs/fr020-review/](../docs/fr020-review/) (PNG files, with HTML sources in `source/`).

## Requested behaviour

Organisers and admins can reserve courts at a facility for a date and time before creating a game, so a game is only
announced once the courts are secured, and two organisers can never book the same court for the same time.

- **Facilities and courts:** a facility has courts, opening hours, a slot length and booking rules. Facility admins
  manage them, including closures for maintenance or events.
- **Organisers:** facility admins decide which group organisers may book, with a weekly court-hour allowance, a limit
  on active bookings, and the option to suspend booking access.
- **Time slots:** organisers pick whole slots on a court grid (courts across, times down). A booking can cover several
  courts and consecutive slots, within the facility's booking window and longest-booking limit.
- **Hold, then confirm:** selecting slots places a short hold (default 10 minutes) so nobody else can take them while
  the organiser confirms. Confirming can create the linked game in the same step.
- **Conflicts:** the database guarantees one active hold, booking or closure per court and time. If two organisers try
  for the same slot, the first to commit wins; the other is told which slot was taken and offered alternatives.
  Nothing is held partially without the organiser's choice.
- **Cancellation:** organisers cancel all or some courts with a reason (same presets and 3–200 character rule as
  FR-019), and choose whether the linked game is cancelled too. A facility setting decides the free-cancellation
  cutoff and whether late cancellations count toward the allowance.
- **Notifications:** emails for booking confirmed, changed or cancelled by the facility, cancellation-cutoff reminder,
  organiser suspended, and (optional) a freed slot someone was watching. Players are only emailed when the linked
  game itself is cancelled.
- **Access:** players see which court their game is on, never the booking grid. Organisers see whether slots are free
  or taken, but only their own group's names. Facility admins see everything for their facility. All of it is enforced
  in the database.

## Mockups for review (2026-11-13)

| File | Shows |
|---|---|
| `01-availability.png` | Court grid with date strip, slot states and allowance bar; hold sheet with countdown and "create a game" option |
| `02-conflicts.png` | Slot taken by another organiser (alternatives, slot watch); hold expired |
| `03-bookings-cancel.png` | Bookings list (confirmed, no game yet, changed by venue); cancel sheet with partial cancel, reason and linked-game choice |
| `04-admin-facility.png` | Facility admin: courts, opening hours, booking rules, new closure with affected bookings |
| `05-admin-organisers.png` | Facility admin: organisers with allowances and status, role matrix, edit-organiser drawer |
| `06-notifications.png` | Booking confirmed, changed by venue and reminder emails; who gets which notification |

## Decisions needed from Jon

See "Open decisions" in the plan. Main ones: who can be a facility admin; default slot length, window and hold time;
whether players ever book directly; whether groups see each other's names on the grid; late-cancellation policy;
and whether to ship before or after multi-group support (FR-001–FR-003).
