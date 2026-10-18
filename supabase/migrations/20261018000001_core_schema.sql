-- PickleMe core schema: groups, membership, invites, games, registrations, audit, notification outbox.
-- All client writes go through security-definer RPCs; tables are read-only to clients under RLS.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.member_role as enum ('player', 'organiser', 'admin');
create type public.game_status as enum ('open', 'closed', 'cancelled');

-- ---------- Tables ----------
create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.groups (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  timezone         text not null default 'Asia/Singapore',
  default_capacity int  not null default 16 check (default_capacity between 1 and 200),
  created_at       timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      public.member_role not null default 'player',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.group_invites (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  token_hash  text not null unique,
  created_by  uuid references auth.users (id) on delete set null,
  expires_at  timestamptz not null,
  max_uses    int not null default 100 check (max_uses between 1 and 1000),
  use_count   int not null default 0,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index group_invites_group_idx on public.group_invites (group_id);

create table public.games (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 80),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  location      text not null default '' check (char_length(location) <= 120),
  capacity      int  not null check (capacity between 1 and 200),
  notes         text not null default '' check (char_length(notes) <= 1000),
  status        public.game_status not null default 'open',
  next_queue_no bigint not null default 1,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index games_group_starts_idx on public.games (group_id, starts_at);

create table public.registrations (
  id            bigint generated always as identity primary key,
  game_id       uuid not null references public.games (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  queue_no      bigint not null,
  joined_at     timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references auth.users (id) on delete set null,
  cancel_reason text check (cancel_reason in ('withdrew', 'removed')),
  unique (game_id, queue_no),
  check ((cancelled_at is null) = (cancel_reason is null))
);
create unique index registrations_one_active_per_user
  on public.registrations (game_id, user_id) where cancelled_at is null;
create index registrations_active_order
  on public.registrations (game_id, queue_no) where cancelled_at is null;
create index registrations_user_idx on public.registrations (user_id);

create table public.audit_events (
  id             bigint generated always as identity primary key,
  group_id       uuid references public.groups (id) on delete cascade,
  game_id        uuid references public.games (id) on delete cascade,
  actor_id       uuid references auth.users (id) on delete set null,
  action         text not null,
  target_user_id uuid references auth.users (id) on delete set null,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index audit_events_game_idx on public.audit_events (game_id, created_at);
create index audit_events_group_idx on public.audit_events (group_id, created_at);

create table public.notification_outbox (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('promoted')),
  game_id         uuid not null references public.games (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  registration_id bigint not null references public.registrations (id) on delete cascade,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  attempts        int not null default 0,
  last_error      text,
  unique (kind, registration_id)
);
create index notification_outbox_pending_idx on public.notification_outbox (created_at) where sent_at is null;

-- Seed config: emails that become admins of a group when they first sign up (server-side only).
create table private.bootstrap_admins (
  email    text primary key,
  group_id uuid not null references public.groups (id) on delete cascade
);

-- ---------- Table privileges: clients may only read ----------
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.groups, public.group_members, public.group_invites,
                public.games, public.registrations, public.audit_events to authenticated;
-- notification_outbox: no client access at all.

alter table public.profiles            enable row level security;
alter table public.groups              enable row level security;
alter table public.group_members       enable row level security;
alter table public.group_invites       enable row level security;
alter table public.games               enable row level security;
alter table public.registrations       enable row level security;
alter table public.audit_events        enable row level security;
alter table public.notification_outbox enable row level security;

-- ---------- Private helpers (not exposed through the API) ----------
create or replace function private.is_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m
                 where m.group_id = p_group_id and m.user_id = (select auth.uid()));
$$;

create or replace function private.has_role(p_group_id uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m
                 where m.group_id = p_group_id and m.user_id = (select auth.uid())
                   and m.role = any (p_roles));
$$;

create or replace function private.shares_group(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members a
                 join public.group_members b on b.group_id = a.group_id
                 where a.user_id = (select auth.uid()) and b.user_id = p_user_id);
$$;

create or replace function private.game_group(p_game_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select g.group_id from public.games g where g.id = p_game_id;
$$;

-- Registration ids currently holding attendee places (top `capacity` active entries).
create or replace function private.attendee_reg_ids(p_game_id uuid)
returns bigint[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(x.id), '{}') from (
    select r.id from public.registrations r
    where r.game_id = p_game_id and r.cancelled_at is null
    order by r.queue_no
    limit (select g.capacity from public.games g where g.id = p_game_id)
  ) x;
$$;

-- Queue promoted players into the notification outbox (deduplicated per registration).
create or replace function private.record_promotions(p_game_id uuid, p_before bigint[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_after bigint[] := private.attendee_reg_ids(p_game_id);
  v_count int;
begin
  insert into public.notification_outbox (kind, game_id, user_id, registration_id)
  select 'promoted', r.game_id, r.user_id, r.id
  from public.registrations r
  where r.id = any (v_after) and not (r.id = any (p_before))
  on conflict (kind, registration_id) do nothing;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into public.audit_events (group_id, game_id, actor_id, action, details)
    values (private.game_group(p_game_id), p_game_id, auth.uid(), 'promoted', jsonb_build_object('count', v_count));
  end if;
  return v_count;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_member(uuid), private.has_role(uuid, public.member_role[]),
                         private.shares_group(uuid) to authenticated;

-- ---------- RLS policies (read-only) ----------
create policy profiles_read on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.shares_group(user_id));

create policy groups_read on public.groups for select to authenticated
  using (private.is_member(id));

create policy group_members_read on public.group_members for select to authenticated
  using (private.is_member(group_id));

create policy group_invites_read on public.group_invites for select to authenticated
  using (private.has_role(group_id, array['organiser', 'admin']::public.member_role[]));

create policy games_read on public.games for select to authenticated
  using (private.is_member(group_id));

create policy registrations_read on public.registrations for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and private.is_member(g.group_id)));

create policy audit_events_read on public.audit_events for select to authenticated
  using (private.has_role(group_id, array['organiser', 'admin']::public.member_role[]));

-- ---------- New-user bootstrap ----------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_members (group_id, user_id, role)
  select b.group_id, new.id, 'admin' from private.bootstrap_admins b
  where lower(b.email) = lower(new.email)
  on conflict (group_id, user_id) do update set role = 'admin';
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.registrations, public.games;
