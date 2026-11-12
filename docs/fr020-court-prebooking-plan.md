# FR-020 — Court and facility prebooking: implementation plan

- Status: Draft for review, 2026-11-13. Nothing in this plan has been built. Code and database changes start only after
  Jon approves the plan and the mockups.
- Feature request: [feature-requests/FR-020-court-prebooking.md](../feature-requests/FR-020-court-prebooking.md)
- Mockups: [docs/fr020-review/](fr020-review/)
- Target versions: v0.14.0 (data model and booking core) → v0.15.0 (UI and notifications) → v0.16.0 (admin tools).

## 1. Goals and non-goals

**Goals**

1. Organisers reserve courts at a facility before announcing a game, and can turn a booking into a game in one step.
2. A court can never be double-booked, even when two organisers act at the same second or a phone retries a request.
3. Facility admins control courts, hours, rules, closures and which organisers can book how much.
4. Everyone affected hears about confirmations, changes and cancellations, through the existing email outbox pattern.
5. All permissions are enforced in the database (security-definer functions and row-level security), as in the rest
   of PickleMe.

**Non-goals for this feature**

- Payments, deposits or fees. A `fee_note` text field can describe charges; nothing is collected.
- Integrating with any third-party or public booking system. PickleMe keeps its own allocation records only.
- Players booking courts directly. Players keep using games; booking is an organiser and admin tool.
- Recurring bookings (every Tuesday). Planned as a follow-up (section 13) once single bookings are proven.

## 2. Concepts and roles

| Concept | Meaning |
|---|---|
| Facility | A place with bookable courts, e.g. "Eastside Sports Centre". Has a timezone, address and coordinates. |
| Court | One bookable unit in a facility (Court 1, Court 2, ...). Can be made unbookable without deleting history. |
| Rule set | Versioned booking rules for a facility: slot length, window, hold time, limits, cancellation policy. |
| Allocation | One court for one continuous period. It belongs to either a booking or a closure. The no-overlap rule lives here. |
| Booking | One organiser's request covering one or more courts for the same date. Has a status and an optional linked game. |
| Hold | A booking in status `held` with an expiry. Blocks the slots until confirmed, released or expired. |
| Closure | A facility admin's block on courts and times (maintenance, events). Uses the same allocation table. |
| Organiser grant | Permission for a group organiser or admin to book at a facility, with allowance and status. |

**Roles.** Group roles stay as they are (`player`, `organiser`, `admin`). One new facility-scoped role is added:

- **Facility admin** — stored in `facility_admins`, not in `member_role`, because a facility can serve several groups
  and a group admin should not automatically control a shared venue. The first facility admin is seeded server-side,
  like `private.bootstrap_admins`.

## 3. Data model

All tables live in `public` with row-level security on and no direct client writes (clients call functions), except
where marked `private`. Times are `timestamptz`; display uses the facility timezone.

```sql
create extension if not exists btree_gist;

create type public.booking_status    as enum ('held', 'confirmed', 'partially_cancelled', 'cancelled', 'expired', 'released');
create type public.allocation_status as enum ('held', 'confirmed', 'cancelled', 'expired', 'released', 'closure', 'closure_lifted');
create type public.organiser_status  as enum ('active', 'suspended', 'revoked');

-- Facilities and courts ----------------------------------------------------------
create table public.facilities (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  address         text not null default '' check (char_length(address) <= 200),
  latitude        numeric(9, 6) check (latitude between -90 and 90),
  longitude       numeric(9, 6) check (longitude between -180 and 180),
  timezone        text not null default 'Asia/Singapore',
  booking_enabled boolean not null default false,          -- feature flag per facility
  active_rule_set uuid,                                    -- fk added after facility_rule_sets
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create table public.courts (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  surface     text not null default '' check (char_length(surface) <= 60),
  sort_order  int  not null default 0,
  bookable    boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (facility_id, name)
);

-- Versioned rules: a booking keeps the rule set it was made under -------------------
create table public.facility_rule_sets (
  id                        uuid primary key default gen_random_uuid(),
  facility_id               uuid not null references public.facilities (id) on delete cascade,
  slot_minutes              int  not null default 60  check (slot_minutes in (30, 60, 90, 120)),
  window_days               int  not null default 7   check (window_days between 1 and 60),
  release_time_local        time not null default '00:00',
  hold_minutes              int  not null default 10  check (hold_minutes between 2 and 30),
  max_booking_minutes       int  not null default 180 check (max_booking_minutes between 30 and 720),
  max_courts_per_booking    int  not null default 4   check (max_courts_per_booking between 1 and 20),
  min_notice_minutes        int  not null default 60  check (min_notice_minutes between 0 and 10080),
  free_cancel_hours         int  not null default 24  check (free_cancel_hours between 0 and 336),
  late_cancel_counts        boolean not null default true,
  default_weekly_minutes    int  not null default 600 check (default_weekly_minutes between 0 and 10080),
  default_max_active        int  not null default 6   check (default_max_active between 1 and 100),
  created_by                uuid references auth.users (id) on delete set null,
  created_at                timestamptz not null default now()
);
alter table public.facilities add constraint facilities_rule_set_fk
  foreign key (active_rule_set) references public.facility_rule_sets (id);

create table public.facility_hours (                       -- weekly pattern, local time
  facility_id uuid not null references public.facilities (id) on delete cascade,
  weekday     int  not null check (weekday between 0 and 7),   -- ISO 1–7, 0 = public holiday row
  opens_at    time not null,
  closes_at   time not null check (closes_at > opens_at),
  primary key (facility_id, weekday)
);
create table public.facility_holidays (                    -- dates that use the weekday-0 hours
  facility_id uuid not null references public.facilities (id) on delete cascade,
  day         date not null,
  label       text not null default '',
  primary key (facility_id, day)
);

-- Who may use and manage a facility ---------------------------------------------
create table public.facility_admins (
  facility_id uuid not null references public.facilities (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  granted_by  uuid references auth.users (id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (facility_id, user_id)
);

create table public.facility_groups (                      -- which groups may book here
  facility_id uuid not null references public.facilities (id) on delete cascade,
  group_id    uuid not null references public.groups (id) on delete cascade,
  granted_by  uuid references auth.users (id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (facility_id, group_id)
);

create table public.facility_organisers (                  -- "managing organisers"
  facility_id      uuid not null references public.facilities (id) on delete cascade,
  group_id         uuid not null references public.groups (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  status           public.organiser_status not null default 'active',
  weekly_minutes   int,                                    -- null = rule-set default
  max_active       int,                                    -- null = rule-set default
  window_days      int,                                    -- null = rule-set default
  suspended_until  timestamptz,
  suspended_reason text check (suspended_reason is null or char_length(btrim(suspended_reason)) between 3 and 200),
  updated_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (facility_id, group_id, user_id),
  foreign key (facility_id, group_id) references public.facility_groups (facility_id, group_id) on delete cascade,
  foreign key (group_id, user_id) references public.group_members (group_id, user_id) on delete cascade
);
```

The last foreign key means removing someone from a group (or the whole group losing facility access) removes their
booking grant automatically. Being demoted to `player` is handled by `private.can_book()` (section 8), which also
requires the person's current group role to be `organiser` or `admin`.

```sql
-- Bookings, closures and the allocation table ---------------------------------------
create table public.court_bookings (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique,                    -- short code, e.g. BK-7Q4M
  facility_id     uuid not null references public.facilities (id) on delete cascade,
  group_id        uuid not null references public.groups (id) on delete cascade,
  organiser_id    uuid references auth.users (id) on delete set null,
  rule_set_id     uuid not null references public.facility_rule_sets (id),
  status          public.booking_status not null default 'held',
  starts_at       timestamptz not null,                    -- earliest allocation start (denormalised)
  ends_at         timestamptz not null,                    -- latest allocation end
  hold_expires_at timestamptz,
  confirmed_at    timestamptz,
  note            text not null default '' check (char_length(note) <= 200),
  game_id         uuid unique references public.games (id) on delete set null,
  cancel_reason_code text,
  cancel_reason   text check (cancel_reason is null or char_length(btrim(cancel_reason)) between 3 and 200),
  cancelled_by    uuid references auth.users (id) on delete set null,
  cancelled_at    timestamptz,
  late_cancel     boolean not null default false,
  version         int not null default 1,                  -- optimistic concurrency for edits
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((status = 'held') = (hold_expires_at is not null))
);
create index court_bookings_group_idx     on public.court_bookings (group_id, starts_at);
create index court_bookings_organiser_idx on public.court_bookings (organiser_id, starts_at);
create index court_bookings_hold_idx      on public.court_bookings (hold_expires_at) where status = 'held';

create table public.facility_closures (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities (id) on delete cascade,
  reason       text not null check (char_length(btrim(reason)) between 3 and 200),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  lifted_at    timestamptz
);

create table public.court_allocations (
  id          bigint generated always as identity primary key,
  court_id    uuid not null references public.courts (id) on delete cascade,
  facility_id uuid not null references public.facilities (id) on delete cascade,
  booking_id  uuid references public.court_bookings (id) on delete cascade,
  closure_id  uuid references public.facility_closures (id) on delete cascade,
  period      tstzrange not null check (not isempty(period) and lower_inc(period) and not upper_inc(period)),
  status      public.allocation_status not null,
  moved_from  bigint references public.court_allocations (id),   -- set when an admin moves a booking
  changed_at  timestamptz not null default now(),
  check ((booking_id is null) <> (closure_id is null)),
  -- The core guarantee: no two blocking allocations on the same court may overlap.
  constraint court_allocations_no_overlap exclude using gist (court_id with =, period with &&)
    where (status in ('held', 'confirmed', 'closure'))
);
create index court_allocations_facility_period on public.court_allocations using gist (facility_id, period);
create index court_allocations_booking_idx     on public.court_allocations (booking_id);

-- Idempotency: a retried request returns the original result instead of booking twice.
create table private.booking_requests (
  user_id         uuid not null,
  idempotency_key uuid not null,
  request_hash    text not null,                           -- sha256 of the normalised request
  booking_id      uuid references public.court_bookings (id) on delete set null,
  result          jsonb not null,
  created_at      timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

-- Optional slot watch: email me if this slot becomes free.
create table public.slot_watches (
  id          bigint generated always as identity primary key,
  court_id    uuid not null references public.courts (id) on delete cascade,
  period      tstzrange not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  group_id    uuid not null references public.groups (id) on delete cascade,
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (court_id, period, user_id)
);

-- Notifications: a separate outbox, so the existing promotion outbox and its checks stay untouched.
create table private.booking_outbox (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('booking_confirmed', 'booking_changed', 'booking_cancelled_by_facility',
                    'booking_cancelled', 'cancel_cutoff_reminder', 'organiser_suspended', 'slot_freed')),
  booking_id      uuid references public.court_bookings (id) on delete cascade,
  recipient_id    uuid not null references auth.users (id) on delete cascade,
  dedupe_key      text not null unique,                    -- e.g. 'booking_confirmed:<booking_id>:<recipient>'
  payload         jsonb not null default '{}'::jsonb,
  not_before      timestamptz not null default now(),      -- used for scheduled reminders
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  skipped_reason  text,
  attempts        int not null default 0,
  last_error      text
);
create index booking_outbox_due_idx on private.booking_outbox (not_before) where sent_at is null and skipped_reason is null;

create table public.notification_prefs (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  booking_reminders  boolean not null default true,
  updated_at         timestamptz not null default now()
);

-- Games link back to their booking (one game per booking).
alter table public.games add column booking_id uuid unique references public.court_bookings (id) on delete set null;

-- Audit: facility-level events reuse audit_events with a facility column.
alter table public.audit_events add column facility_id uuid references public.facilities (id) on delete cascade;
create index audit_events_facility_idx on public.audit_events (facility_id, created_at);
```

**Why one allocation per court per period.** A booking for Courts 2 and 3 from 7 to 9 pm is two allocation rows (one
per court, each covering 7–9 pm), not four hourly rows. The exclusion constraint compares ranges, so a 7–9 pm booking
correctly blocks an 8–10 pm request. Partial cancellation updates the status of one court's row.

**Why closures share the table.** Because closures sit under the same exclusion constraint, a closure can never be
saved on top of a live booking, and a booking can never be made inside a closure. The admin must resolve affected
bookings first (mockup 04).

**History.** Allocation rows are never deleted when a booking is cancelled or moved; their status changes. This
gives the activity log and the "Past / Cancelled" tabs a full history. Retention follows the privacy policy:
bookings older than 12 months are anonymised (`organiser_id` set to null, note cleared) by the existing cleanup job.

## 4. Time-slot allocation rules

All checks run inside the booking functions, in the facility's timezone, using the booking's rule set.

1. **Alignment.** Start and end fall on slot boundaries counted from local midnight (`slot_minutes`). A 60-minute
   facility accepts 7:00–9:00 pm, not 7:30–9:00 pm.
2. **Opening hours.** The whole period sits inside that day's hours (holiday hours when the date is in
   `facility_holidays`). Bookings do not cross midnight.
3. **Window.** The date is no later than `today + window_days`, where new dates appear at `release_time_local`. The
   organiser's `window_days` override applies if set. Start must be at least `min_notice_minutes` from now.
4. **Size.** Each court's period is at most `max_booking_minutes`; at most `max_courts_per_booking` courts; all
   courts in one booking share the same date. Courts may have different times (as in the "keep what's free"
   alternative in mockup 02), but each court's period is continuous.
5. **Court state.** Every court belongs to the facility and is `bookable`; the facility has `booking_enabled`.
6. **Allowance.** The organiser's court-minutes in the booking's week (Monday 00:00 to Sunday 24:00, facility time),
   counting `held` and `confirmed` allocations plus late cancellations when `late_cancel_counts`, plus this request,
   must not exceed `weekly_minutes`. Active bookings (held or confirmed, in the future) must not exceed `max_active`.
7. **Availability grid.** `get_availability` expands opening hours into slots with `generate_series` and left-joins
   blocking allocations, returning one state per court per slot: `free`, `mine` (caller's group), `held`, `booked`,
   `closed`, or `outside_window`. A `held` allocation whose `hold_expires_at` has passed is reported as `free`.

## 5. Concurrency and conflict resolution

### 5.1 Guarantees

- **No double booking:** enforced by the `court_allocations_no_overlap` exclusion constraint. Application checks are
  for helpful messages; the constraint is the final word, so a bug or a direct SQL call still cannot double-book.
- **All or nothing:** a hold request inserts all its allocations in one transaction. If any court is taken, none are
  held and the caller gets the full list of clashes.
- **No lost allowance races:** the organiser's grant row is locked (`select ... for update`) for the duration of the
  request, so two quick requests from the same organiser are checked one after the other.
- **Safe retries:** `(user_id, idempotency_key)` returns the stored result for a repeated request. A reused key with a
  different request body returns `idempotency_key_reused`.
- **Stale edits rejected:** changes to an existing booking (confirm, cancel, move) pass the `version` the client saw;
  a mismatch returns `booking_changed` and the client reloads.

### 5.2 Hold sequence (`hold_courts`)

```text
begin (read committed)
  1. require_uid; load facility + active rule set; check booking_enabled
  2. idempotency: if (uid, key) exists -> return stored result
  3. lock grant: select * from facility_organisers where ... for update   -- serialises this organiser
     check can_book (status active, not suspended, still organiser/admin of the group)
  4. validate slots (section 4, rules 1-5)
  5. lock courts: pg_advisory_xact_lock(hashtext(court_id)) for each court, in sorted court_id order
     -- sorted order prevents deadlocks when two requests share courts
  6. sweep: update court_allocations set status='expired' for held rows on these courts whose booking's
     hold_expires_at < now(); mark those bookings 'expired'
  7. find clashes: select blocking allocations overlapping the requested periods
     if any -> compute alternatives (5.3), store result in booking_requests, return {ok:false, conflicts, alternatives}
  8. check allowance and max_active (rule 6) -> allowance_exceeded / too_many_active
  9. insert court_bookings (status 'held', hold_expires_at = now() + hold_minutes)
     insert court_allocations (one per court, status 'held')
     -- if the exclusion constraint still fires (a writer that skipped the advisory lock),
     -- catch exclusion_violation (23P01) in a sub-block and return the same conflict response
 10. store idempotency result; audit 'booking_held'
commit
```

The advisory locks make step 7's answer reliable and keep the common case free of constraint errors; the exclusion
constraint still protects against anything that bypasses them. Locks are transaction-scoped, so they release
automatically on commit or error.

### 5.3 Alternatives

Computed from the same availability query, at most three, in this order:

1. **Keep what's free** — the requested slots minus the clashing ones, if anything is left.
2. **Same courts, next free time** — the earliest later period on the same date where all requested courts are free
   for the same duration.
3. **Same courts and times, nearest other day** — searching forward, then back, within the window.

Each alternative is returned as a ready-to-send `hold_courts` payload, so tapping **Hold** is one call with a new
idempotency key. Alternatives are suggestions only; nothing is held until the organiser taps.

### 5.4 Hold expiry

- `confirm_booking` checks `hold_expires_at > now()` while holding the booking row lock; an expired hold returns
  `hold_expired` and is marked `expired` in the same transaction.
- A pg_cron job (`pickleme-booking-sweep`, every minute) expires overdue holds across all facilities and queues
  `slot_freed` notifications for matching slot watches.
- Availability treats overdue holds as free even before the sweep runs, and step 6 of `hold_courts` expires them on
  the spot, so a stuck hold never blocks a court for long.

### 5.5 Fairness when new dates open

When a popular date opens at midnight, organisers race for it. v1 handles this with: one active hold per organiser
at a time, `max_courts_per_booking`, weekly allowances, and a short hold time. If this proves unfair in practice, a
follow-up "ballot window" (requests in the first N minutes are collected and allocated randomly with weighting by
used allowance) can be added without changing the allocation table.

### 5.6 Admin changes that collide with bookings

- **Closures:** `preview_closure` returns every affected allocation and suggested free courts for a move.
  `create_closure` takes the admin's resolution for each affected booking (`move` to court X, or `cancel` with a
  reason) and applies the moves, cancellations and closure allocations in one transaction. If any booking changed
  since the preview (`version` mismatch) or a target court is no longer free, nothing is saved and the admin sees a
  fresh preview.
- **Rule changes** create a new rule set and only affect new bookings.
- **Court made unbookable** blocks new holds; existing bookings stay until the admin closes the court (above).

## 6. API endpoints

PickleMe's API is Supabase PostgREST: each function is called as `POST /rest/v1/rpc/<name>` with the user's JWT.
All are `security definer`, set `search_path = ''`, and raise stable error codes (listed below) that the UI maps to
messages. Edge Functions are used only where an external service is called (email).

### 6.1 Organiser and group endpoints

| Endpoint | Who | Input | Returns | Errors |
|---|---|---|---|---|
| `list_bookable_facilities` | organiser, admin | `p_group_id` | facilities the group can book, with the caller's allowance used/total | `forbidden` |
| `get_availability` | organiser, admin, facility admin | `p_facility_id, p_from date, p_to date` (max 14 days) | per court per slot state; own-group bookings include organiser name; other groups shown as `booked`/`held` only | `forbidden`, `range_too_long` |
| `hold_courts` | organiser, admin with active grant | `p_facility_id, p_group_id, p_items [{court_id, starts_at, ends_at}], p_idempotency_key, p_note?` | `{ok:true, booking}` or `{ok:false, conflicts, alternatives}` | `forbidden`, `booking_disabled`, `misaligned_slot`, `outside_hours`, `outside_window`, `too_soon`, `too_long`, `too_many_courts`, `allowance_exceeded`, `too_many_active`, `idempotency_key_reused` |
| `release_hold` | holder, group admin | `p_booking_id` | `{released:true}` | `not_held`, `forbidden` |
| `confirm_booking` | holder | `p_booking_id, p_version, p_create_game? {title, capacity, notes}` | booking, and the new game if requested | `hold_expired`, `booking_changed`, `forbidden` |
| `link_booking_to_game` | organiser, admin of the group | `p_booking_id, p_game_id` | booking | `already_linked`, `different_group`, `game_cancelled` |
| `cancel_booking` | booking organiser, group admin, facility admin | `p_booking_id, p_version, p_court_ids? (null = all), p_reason_code, p_reason, p_cancel_game bool` | updated booking, `late_cancel`, cancelled game if any | `booking_changed`, `already_cancelled`, `booking_started`, `invalid_cancel_reason`, `cancel_reason_required`, `forbidden` |
| `list_group_bookings` | organiser, admin | `p_group_id, p_scope ('upcoming','past','cancelled'), p_cursor` | page of bookings with courts and linked game | `forbidden` |
| `get_booking` | organiser, admin of the group, facility admin | `p_booking_id` | booking, allocations, history | `not_found` |
| `watch_slot` / `unwatch_slot` | organiser, admin | `p_court_id, p_starts_at, p_ends_at` | watch id | `forbidden`, `slot_free` |
| `set_notification_prefs` | any signed-in user | `p_booking_reminders` | prefs | — |

`confirm_booking` with `p_create_game` creates the game through the existing game-creation code path in the same
transaction: title and capacity from the form; `starts_at`/`ends_at` from the booking; `location` set to
"Facility name · Courts 2 & 3"; `games.booking_id` set; and, if the facility has coordinates, a `weather_venues`
row upserted for the group and that location, so the FR-017 weather card works with no extra setup.

`cancel_booking` with `p_cancel_game = true` calls the same internal function as `cancel_game` (FR-019) with the
same reason, so the game note, activity log and player emails are identical to a normal cancellation. With
`p_cancel_game = false`, the game stays and shows "No court booked" to organisers.

`get_game` and `list_games` gain a `court` object (`facility_name`, `court_names`, `booking_status`) so players see
which courts their game is on, without seeing the booking itself.

### 6.2 Facility admin endpoints

| Endpoint | Input | Effect |
|---|---|---|
| `create_facility` | name, address, coordinates, timezone | creates facility, first rule set and the caller as facility admin (only for platform bootstrap admins) |
| `update_facility` | facility id, fields | name, address, coordinates, `booking_enabled` |
| `upsert_court` / `set_court_bookable` | facility id, court fields | add or edit courts; never deletes a court with history |
| `set_facility_hours` / `set_facility_holidays` | weekly hours / holiday dates | replaces the pattern; rejected if it would leave a live booking outside hours (returns the affected list) |
| `publish_rule_set` | rule values | inserts a new rule set and makes it active |
| `grant_facility_group` / `revoke_facility_group` | group id | revoking requires choosing what happens to that group's future bookings |
| `upsert_facility_organiser` | group id, user id, allowance, max active, window override | user must be organiser or admin of the group |
| `suspend_facility_organiser` / `reinstate_facility_organiser` | user, until, reason | queues `organiser_suspended` to the organiser and group admins |
| `add_facility_admin` / `remove_facility_admin` | user id | cannot remove the last facility admin |
| `preview_closure` | courts, period, reason | affected bookings and move suggestions; no changes |
| `create_closure` | courts, period, reason, resolutions | applies moves, cancellations and the closure atomically |
| `lift_closure` | closure id | marks allocations `closure_lifted`; notifies slot watchers |
| `admin_move_booking` | booking id, version, court mapping | moves allocations to free courts at the same times; queues `booking_changed` |
| `admin_cancel_booking` | booking id, version, courts, reason | as `cancel_booking`, plus `booking_cancelled_by_facility` to the organiser and group admins |
| `list_facility_bookings` | facility, date range, filters, cursor | all bookings with group and organiser names; CSV export in the UI |
| `list_facility_activity` | facility, filters, cursor | facility audit events (same shape as the FR-013 activity log) |

### 6.3 Service endpoints (Edge Function only)

Following the promotion-email pattern (`claim_promotion_emails` / `complete_promotion_email`), guarded by the shared
outbox secret rather than a user JWT:

| Endpoint | Purpose |
|---|---|
| `claim_booking_notifications(p_secret, p_limit)` | claims due rows (`not_before <= now()`), re-checks they are still relevant, returns payloads |
| `complete_booking_notification(p_secret, p_id, p_ok, p_error)` | marks sent, or schedules a retry with backoff |
| `release_booking_notifications(p_secret, p_ids, p_reason)` | returns claimed rows if the function stops early |

## 7. Notification workflows

### 7.1 Pipeline

1. A booking function inserts rows into `private.booking_outbox` in the same transaction as the change, so a
   notification exists if and only if the change committed. `dedupe_key` prevents duplicates.
2. An `after insert` trigger calls `private.kick_send_booking_emails()` (pg_net) to wake the Edge Function, and a
   pg_cron sweep every two minutes catches anything missed, as with promotion emails.
3. The `send-booking-emails` Edge Function claims a batch, renders each email with the same HTML layout as the
   promotion email, sends via Resend from `pickleme.doblados.net`, and completes each row.
4. Retries back off at 1, 5, 15, 60 minutes; after 6 failed attempts the row stops retrying and appears in the
   admin's activity log as "email not delivered".

### 7.2 Relevance checks at send time

A claimed row is skipped (with `skipped_reason`) rather than sent if:

- `booking_confirmed`: the booking has since been cancelled.
- `cancel_cutoff_reminder`: the booking is cancelled, the cutoff has passed, or the recipient turned reminders off.
- `slot_freed`: the slot has been taken again; the watch is marked notified either way.
- any kind: the recipient's account no longer exists.

### 7.3 Events and recipients

| Event | Queued by | Recipients | Email |
|---|---|---|---|
| Booking confirmed | `confirm_booking` | organiser who booked | yes |
| Cancelled by organiser | `cancel_booking` | organiser (copy); slot watchers | yes; players only via the FR-019 game cancellation if the game is cancelled |
| Cancelled by facility | `admin_cancel_booking`, `create_closure` | organiser, group admins; slot watchers | yes, with the facility's reason |
| Moved by facility | `admin_move_booking`, `create_closure` | organiser, group admins | yes; players are not emailed for a court change |
| Hold expired | sweep | holder | in-app only (no email) |
| Cancellation cutoff reminder | `confirm_booking` schedules with `not_before = start − free_cancel_hours − 3 h` | organiser | yes, opt-out in profile |
| Organiser suspended | `suspend_facility_organiser` | organiser, group admins | yes |
| Slot freed | release, expiry, cancellation, closure lifted | watchers of an overlapping slot | yes, no automatic booking |

## 8. Admin access controls

### 8.1 Helper functions (private, not callable by clients)

```sql
private.is_facility_admin(p_facility_id uuid) returns boolean
private.group_can_use_facility(p_facility_id uuid, p_group_id uuid) returns boolean
private.can_book(p_facility_id uuid, p_group_id uuid) returns boolean
  -- caller has role organiser/admin in the group (private.has_role)
  -- and the group is in facility_groups
  -- and an active, unsuspended facility_organisers row exists
  -- (facility admins may book on behalf of any granted group)
private.can_manage_booking(p_booking_id uuid) returns boolean
  -- booking organiser, an admin of the booking's group, or a facility admin
```

### 8.2 Permission matrix

| Action | Player | Organiser | Group admin | Facility admin |
|---|---|---|---|---|
| See which courts a game is on | ✓ | ✓ | ✓ | ✓ |
| See the court grid | — | ✓ (with grant) | ✓ (with grant) | ✓ |
| See who holds another group's slot | — | — | — | ✓ |
| Hold, confirm, cancel own bookings | — | ✓ within allowance | ✓ within allowance | ✓ |
| Cancel another organiser's booking in the same group | — | — | ✓ | ✓ |
| Move bookings, add closures | — | — | — | ✓ |
| Change courts, hours, rules | — | — | — | ✓ |
| Grant groups and organisers, set allowances, suspend | — | — | — | ✓ |
| Add or remove facility admins | — | — | — | ✓ (not the last one) |

### 8.3 Enforcement

- **Tables:** `revoke all` from `anon` and `authenticated` on every new table; RLS enabled. Clients read only through
  functions, which return just the fields each role may see (other groups appear as `booked`/`held` with no names).
  This matches the FR-013 approach of removing raw-table reads where data needs filtering.
- **Writes:** only through the functions in section 6, each starting with `private.require_uid()` and the relevant
  helper.
- **Service functions:** `claim_*` / `complete_*` check the outbox secret and are not granted to `authenticated`.
- **Audit:** every write records an `audit_events` row with `facility_id`, `group_id` where relevant, the actor, and
  before/after values for rule, allowance, suspension and admin-move changes. Facility admins see facility events;
  group admins see their group's booking events in the existing activity log.
- **Privacy:** no email addresses are returned by any booking endpoint. Organiser names shown to facility admins are
  display names only. The privacy policy and FAQ gain a short section on court bookings and who can see them.

## 9. UI changes

| Area | Change | Mockup |
|---|---|---|
| Header tabs | New **Courts** tab for organisers and admins whose group has a bookable facility | 01 |
| Court grid | Facility picker, date strip with window, court × time grid, legend, allowance bar, selection bar | 01a |
| Hold sheet | Countdown, summary, "create a game" toggle with title/players, release and confirm | 01b |
| Conflict and expiry states | Clash message, requested vs taken slots, three alternatives, slot watch | 02 |
| Bookings list | Upcoming / Past / Cancelled, game link or "Create game", changed-by-venue notes | 03a |
| Cancel sheet | Court checkboxes, FR-019 reason presets, note, linked-game choice, cutoff notice | 03b |
| Game page and list | "Courts 2 & 3 · Eastside Sports Centre" line; organisers see "No court booked" when unlinked | — |
| Facility admin | Setup & rules, courts, closures with affected bookings, organisers & access, all bookings, activity log | 04, 05 |
| Profile | "Booking reminders" switch | — |
| Emails | Confirmed, changed, cancelled by facility, reminder, suspended, slot freed | 06 |

Client details: generate the idempotency key (`crypto.randomUUID()`) when the organiser taps **Hold** and reuse it for
retries of that tap; refresh the grid every 30 seconds while open and immediately after any conflict; show the hold
countdown from the server's `hold_expires_at`, not the device clock.

## 10. Migrations and files

| File | Contents |
|---|---|
| `supabase/migrations/20261116000018_court_booking_core.sql` | extension, types, tables, constraints, helpers, RLS, grants |
| `supabase/migrations/20261116000019_court_booking_rpc.sql` | organiser endpoints, availability, hold/confirm/cancel, game linking |
| `supabase/migrations/20261116000020_court_booking_admin.sql` | facility admin endpoints, closures, moves, audit additions |
| `supabase/migrations/20261116000021_booking_notifications.sql` | outbox, triggers, claim/complete functions, reminder scheduling |
| `supabase/rollout/fr020_enable_booking_schedules.sql` | `pickleme-booking-sweep` (every minute), `pickleme-send-booking-emails` sweep (every 2 min) |
| `supabase/functions/send-booking-emails/index.ts` | Edge Function, Resend templates |
| `src/screens/Courts.tsx`, `CourtGrid.tsx`, `HoldSheet.tsx`, `Bookings.tsx`, `CancelBooking.tsx` | organiser UI |
| `src/screens/FacilityAdmin*.tsx` | facility admin UI |
| `src/lib/bookings.ts` | typed RPC wrappers and error-code messages |

Migration dates are placeholders and will be set when work starts.

## 11. Testing plan

**Database (pgTAP-style SQL in `supabase/tests/court_booking*.sql`, run in CI like the existing suites)**

- Exclusion constraint: overlapping, adjacent (7–8 and 8–9 allowed), and contained periods; closures vs bookings.
- Each validation rule in section 4, including holiday hours, window release time and Singapore-time week edges.
- Allowance: exactly at limit, one slot over, late cancellations counted or not per rule set.
- Every endpoint for every role, plus cross-group and cross-facility isolation (an organiser of group A cannot read
  or cancel group B's booking, or see group B's name on the grid).
- Idempotency: same key and body returns the same booking; same key, different body is rejected.
- Hold expiry: confirm after expiry fails; expired holds don't block a new hold; sweep queues slot-watch emails.
- Closure with affected bookings: all-or-nothing when one move target becomes unavailable.
- Partial cancel; cancel with linked game reuses the FR-019 path and note.

**Concurrency (script in `tests/booking-race.test.mjs`)**

- 20 parallel `hold_courts` calls for the same court and time from different organisers: exactly one succeeds, 19
  receive `ok:false` with the same clash, no constraint error reaches the client.
- Overlapping multi-court requests in opposite court order: no deadlock (sorted advisory locks).
- Same organiser, two parallel requests that together exceed the allowance: one succeeds.
- Confirm racing the sweep at the expiry second: either confirmed or expired, never both.

**UI (harness pages and Playwright, as with the activity log and weather card)**

- Grid states and legend, selection rules, hold countdown, conflict and expiry screens, cancel sheet validation, admin
  closure flow, mobile at 390 px and desktop at 1280 px.

**Email:** rendered snapshots for each kind; send-time skip rules.

## 12. Rollout

1. **v0.14.0 — core.** Migrations 18–20 applied with `booking_enabled = false` for every facility. Seed one facility,
   its courts and hours, and Jon as facility admin. Run the database and race tests against production-like data.
2. **v0.15.0 — organiser UI and emails.** Deploy the Courts tab behind `booking_enabled`; deploy
   `send-booking-emails`; enable schedules; turn on booking for the first facility with Jon and one organiser.
3. **v0.16.0 — admin tools.** Closures, moves, organiser management, facility activity log and CSV export.
4. Update the privacy policy, FAQ and guide; record the release in `changelog.md`; mark FR-020 Implemented.

Rollback: set `booking_enabled = false` (UI hides the Courts tab; endpoints return `booking_disabled`); unschedule the
cron jobs. Existing games are unaffected because `games.booking_id` is nullable.

## 13. Follow-ups (not in this feature)

- Recurring bookings with a series id and per-occurrence exceptions.
- Ballot window for high-demand release times (5.5).
- Waitlist for a fully booked slot with automatic offer-and-hold.
- Multi-group UI: once FR-001–FR-003 ship, the Courts tab follows the group switcher; until then it uses the current
  group, while the data model already supports several groups per facility.

## 14. Open decisions for Jon

1. **Facility admins:** only Jon at first, or also named group admins? Can a group admin create a facility?
2. **Defaults:** 60-minute slots, 7-day window opening at midnight, 10-minute hold, 3-hour maximum, 24-hour free
   cancellation, 10 court-hours a week per organiser — keep or change?
3. **Visibility:** should organisers see other groups' names on the grid, or only "Booked"? (Plan: only "Booked".)
4. **Late cancellations:** count toward the allowance (plan) or only be logged?
5. **Players:** keep booking organiser-only (plan), or let trusted players request a booking for organiser approval?
6. **Slot watch:** include in v0.15.0 or defer?
7. **Order of work:** build FR-020 before or after multi-group support (FR-001–FR-003)?
8. **Real facility details:** which facility, courts and opening hours should be seeded first?
