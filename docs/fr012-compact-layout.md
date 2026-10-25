# FR-012 compact layout revision — 25 October 2026

Approved preview: 1100 px wide, original font sizes, compact grids, and additional header bottom padding. No signup, sharing or permissions changes.

- Width is now 1100 px; the supplied 10-player, empty-waitlist sample renders at 1100 x 1152 instead of 1200 x 1704.
- Original type sizes retained: player names 26 px, title 44 px, headings 31 px, slot numbers 22 px.
- Playing cells are normally 82 px high; waitlist cells 67 px, with 10 px gaps. Four columns, 16 playing slots and eight waitlist slots remain for a capacity-16 game.
- Header content determines its height, including at least 37 px of line-box clearance below the location. Wrapped title/date/time/location adds height instead of overlapping.
- Long names expand the affected row rather than shrinking the original font. Footer text wraps if necessary. Excessively large images are rejected explicitly rather than omitting names.

Verification before commit: seven Node renderer tests passed. Actual Chromium PNG generation passed for the sample (1100 x 1152), long text (1100 x 1377), and a 12-person waitlist (1100 x 1229), with no text outside image bounds in these cases.

The branch CI workflow runs dependency installation, renderer tests and the full application build when committed. CI success is not yet claimed. No production deployment is authorised by this branch commit. Update the main changelog on release.
