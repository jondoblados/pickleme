# FR-013 implementation log — 26 October 2026

Status: backend foundation and test preparation on feature/fr013-admin-activity-log; not deployed. The approved Activity log mockup is the frontend target. This first increment does not yet add the tab.

## Prepared
- Migration 11 narrows raw audit-event reads to group admins; list_activity_log checks admin membership independently, uses group-local dates, bounded keyset pages and a fixed as_of boundary. IDs remain strings in JSON/CSV.
- Query returns allow-listed details, not arbitrary event JSON. Legacy records are labelled backfilled_current, not claimed to have historical names/field changes.
- Future entries capture actor/target display names and game context. Existing entries are backfilled using only currently available data. These snapshots require the same retention/anonymisation treatment as other personal audit data.
- Game deletion sets the audit game foreign key to null instead of deleting history. Saved game context supports filters and display after deletion. Previously erased history is not recoverable.
- update_game preserves validation, lock and promotion logic while adding field-level before/after values for future edits.
- The existing organiser invite-history RPCs retain their narrow same-group access; tests cover this dependency without restoring organiser access to the general log.
- Shared label/change/CSV helpers and five Node tests are prepared for reuse by the frontend. CSV neutralises spreadsheet formula prefixes.

## Testing boundaries
Five client-helper Node tests passed locally. SQL tests have NOT run locally: no PostgreSQL server is installed in this execution environment. The new workflow provisions an ephemeral PostgreSQL 17 service with synthetic auth/roles, loads core plus invite/deletion baseline migrations, applies migration 11, and runs assertion-based SQL tests in a rolled-back transaction. It uses no Supabase connection or production secrets and has no deployment steps.

The isolated baseline is not a full Supabase/Auth/Realtime installation. Before release, run complete regression tests with all migrations, including attendance, late signup, promotion email and deleted-account session handling. Add timezone-boundary, pagination/export concurrency and legacy-backfill fixtures, and confirm the actual production schema has no drift.

## Next increment
- Build the admin-only tab, filters, expandable edits, pagination and paginated CSV export from the approved mockup; add route/API types and React interaction tests.
- Include a disclaimer for incomplete legacy history; retain clear distinction between actor and affected player.
- Mark the feature In progress in the main tracker and add the release changelog when committing that integration. Never mark Implemented before acceptance.
- Add retention cleanup for snapshot fields and consider privacy wording. No production migration or merge until separately approved.
