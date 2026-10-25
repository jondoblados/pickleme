# FR-012 900px three-column layout — 25 October 2026

Status: implementation prepared on feature/fr012-900px-three-column; not merged or deployed.

Approved direction: 900 px width, three columns and eight rows for 16 Playing slots plus eight Waitlist slots. Original fonts retained. Row six is Playing 16 / W1 / W2. Warm waitlist cells have explicit W-number and Waitlist labels; their status never depends on colour alone.

The combined grid retains all Playing places and at least eight Waitlist places. Additional waitlisted players extend the grid. Non-standard capacities do not add fake Playing slots. Long names, header text and footer text wrap, expanding the relevant rows/sections. Header clearance and privacy filtering remain; signup, permissions and sharing behaviour are unchanged. The sample dimensions are content-dependent, not a fixed crop.

Verification before commit: seven Node tests passed. Actual Chromium PNG rendering checked the supplied sample, long/Unicode text, 12 waitlisted players, and capacity 5, with no text outside image bounds in those cases. The attached renderer-generated sample is not live roster data.

The branch workflow is configured to run renderer tests and the full app build after commit; success is not claimed yet. No Supabase changes. Review CI and obtain separate merge/deployment approval before release; update the main changelog on release.
