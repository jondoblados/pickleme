# FR-017 — Changi Business Park weather forecasts

- Status: Released (v0.11.0, 2026-11-07); hourly schedule pending a test fetch with a configured venue.
- Implementation notes: [docs/fr017-weather.md](../docs/fr017-weather.md).
- Requested: 2026-11-05 by Jon.

## Decisions (2026-11-07)

- Day-before overview: the complete game date, 00:00–24:00 Singapore time.
- Game-day window: one hour before the start until one hour after the end.
- Venue: the address used for the game. The game's location text is mapped once, by an organiser or admin, to a
  confirmed address and coordinates; every game in the group with the same location shares it.

## Requested behaviour

Pull weather for Changi Business Park, Singapore, once every hour on the calendar day before a game and on game day, using Asia/Singapore time. Fetch server-side and cache by location/hour, shared across games and users; do not make upstream calls per browser.

Day before: display a 24-hour forecast. Proposed interpretation for review: the upcoming game date, 00:00–24:00 SGT, rather than a rolling next-24-hours window. Always show forecast validity.

Game day: display hourly forecasts from one hour before game start until one hour after game end. This interprets 'within the hour of the start' as one hour before start, subject to review. A 19:00–21:00 game shows 18:00 through 22:00 markers. Support half-hour starts, all overlapping hourly periods, exact start/end highlighting and midnight crossings.

Use lightweight, accessible weather icons with condition text, matching existing court-green, lime and cream styling. Show temperature in Celsius, rain probability where available and optional wind in km/h. Place the weather card below game details and above the roster; scroll the hourly strip on small screens. Never imply the forecast is permission to play.

## Source and reliability requirements

NEA provides a 24-hour outlook normally updated every six hours and a separate two-hour nowcast; neither should be relabelled as a venue-specific hourly forecast. Proposed primary source is Open-Meteo coordinate-based hourly data, from which the game-date overview and game-window timeline can be derived. Validate venue coordinates, coverage, licence/commercial terms, attribution and quotas before implementation. Do not silently blend providers or imply court-level precision.

Display source, coverage, valid times, last successful fetch and provider issue time when available. Hourly fetching does not imply hourly model updates. Respect preceding-hour precipitation semantics; never sum hourly rain probabilities or label their maximum as a daily probability.

Proposed stale threshold: two hours. Preserve the last successful forecast with a stale label; display unavailable/missing data honestly. No automatic game cancellation and no claim of live lightning detection.

Schedule hourly slots from 00:00 on the previous date through 23:00 on game date; extend for overnight games through the post-game window if required. Stop eligibility for cancelled/deleted games and recalculate after rescheduling or location changes. Games created mid-window populate on the next scheduled slot. Bound failures and avoid uncontrolled retries. Keep game/group schedules private; send no member or group details to the provider.

## Mockup for review

Two states: day-before 24-hour overview and game-day hourly timeline for a sample 19:00–21:00 game. Mockup values are fictional, not live forecasts. Use existing colours #14382b, #d9f24a and #f5f2ea, rounded cards and SVG condition icons. A separate PNG review mockup and expanded Markdown specification were generated in the conversation; neither is deployed or embedded in this repository by this change.

## Acceptance

Test SGT calendar boundaries; midnight and half-hour games; exact before/after coverage; shared hourly cache; no per-user upstream requests; cancellation and rescheduling; stale, unavailable and partial responses; source and issue/fetch timestamp labels; accessible text/icon/colour combinations; mobile scrolling; private-game access checks; and no automatic cancellation.

## Source documentation

- https://data.gov.sg/datasets/d_ce2eb1e307bda31993c533285834ef2b/view
- https://data.gov.sg/collections/1456/view
- https://open-meteo.com/en/docs

This standalone feature-request file does not modify the root feature-requests.md index.
