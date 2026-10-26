# FR-013 UI integration — 26 October 2026

Prepared: admin-only Activity log navigation and direct-route guard; date/game/person/action filters; group-local timestamps; read-only table with expandable before/after edits; cursor-based Previous/Next; paginated CSV export using applied filters and a fixed as_of boundary. Duplicate display names include an ID suffix in filters. Legacy context is labelled rather than presented as exact historical identity.

Migration 12 supplies admin-only date-scoped game/person choices from audit snapshots, including deleted games and former members. The isolated CI job loads this migration too. No production database change is implied by committing these files.

Export cancellation and error handling avoid saving partial files. Large exports stop after 50,000 records and ask for a narrower range. Filter editing does not silently change the exported query. Errors clear displayed results; role enforcement remains in database functions/policies, not merely navigation.

Verified before this increment: branch backend build and isolated SQL tests for migration 11 passed. UI build, browser interaction/accessibility tests, filter-options permission/deleted-context tests, full Supabase regressions and retention cleanup remain pending. The UI is not production-ready until those checks and separate release approval are complete. Main feature tracker and changelog release statuses still need reconciliation.
