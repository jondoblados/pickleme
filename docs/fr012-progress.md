# FR-012 — WhatsApp roster image sharing

Status: In progress on feature/whatsapp-roster-image. Not deployed. Keep the main tracker Requested until the branch is reviewed; mark Implemented only after acceptance.

## Implementation log — 24 October 2026
- Browser-side Canvas PNG renderer; four columns, 16 playing slots for a capacity-16 game, at least eight waitlist slots, expanded rows without silently dropping names.
- Reuse get_game for a fresh authorised roster on each generation; check returned organiser/admin role again before rendering. Existing member-only roster access is unchanged. No database migrations, new public endpoints or uploaded images.
- Names/positions only; no email, user IDs, YOU markers, attendance or admin buttons in the image. Cancelled/closed status is included in the heading.
- Organiser-only Share roster image card below the game page, with Generate/Refresh, preview, Download PNG, device sharing, and copyable caption/game link.
- Separate generation and share taps preserve the browser user-gesture requirement. Unsupported file sharing falls back to download/caption. Cancellation is not reported as success.
- Snapshot date/time/timezone and non-live warning; changing games/unmounting releases the image URL and invalidates pending generation.
- Existing GamePage text-sharing and attendance remain unchanged. Renderer limits excessively large canvases explicitly rather than omitting names.

## Verification completed
- Six Node tests passed: layout/open slots, waitlist overflow/order, non-four-multiple capacities, invalid capacity/size bounds, Unicode/plain-text rendering and private-field exclusion, failed canvas/PNG encoding.
- Actual headless Chromium canvas generation succeeded: 1200 x 1704 PNG with 10 supplied example players and empty waitlist. Screenshot attached to the implementation conversation; not live roster data.
- Build-only GitHub Actions workflow added for this feature branch/PR. No deployment steps.

## Still required before merge/deploy
- Successful npm ci / npm run build in CI (not claimed locally).
- React interaction tests: loading and errors, role rejection, refreshing while data changes, unmount cleanup, unsupported share, cancelled/failed share, download and caption copy.
- iPhone and Android native share-sheet/WhatsApp caption tests; desktop and WhatsApp Web manual fallback checks.
- Review dense/Unicode/long-name layouts at mobile preview size and verify role changes do not leave misleading controls.
- Update feature-requests.md, changelog.md, FAQ and privacy wording as appropriate before release. No production changes without approval.
