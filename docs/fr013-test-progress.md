# FR-013 interaction and filter tests — 26 October 2026

UI integration commit 8cb814e9cc987cd5059281d6517180753db8f334 passed all five available CI checks, including app build/typecheck and the existing isolated SQL suite.

This increment prepares seven Playwright tests against the real ActivityLog component using mocked RPC responses: non-admin guard/no requests, expanded edits and pagination, applied filters/date reset, multi-page CSV and formula protection, export cancellation, permission-error clearing, and mobile table scrolling. The test harness does not test the full App navigation or real Supabase Auth; those remain separate acceptance checks.

Browser CI points the Supabase client at the local Vite server and intercepts RPC calls. It uses a fake key, no production sessions or secrets. Browser tooling is installed only in the ephemeral CI workspace, not added to the app dependencies/lockfile.

A disposable PostgreSQL suite adds historical filter choice tests for role restrictions, empty ranges, local-date inclusion, retained deleted-game/former-member choices, invalid dates and anonymous execution. New browser and filter tests are prepared, not yet claimed passing. No production changes or deployment steps.
