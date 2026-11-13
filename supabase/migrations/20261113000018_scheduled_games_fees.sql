-- FR-021: scheduled game visibility, court booking fees and game-day slot confirmation.
--
--   * games.visibility ('now' | 'week_before' | 'two_weeks_before') and games.visible_from (kept in step with
--     starts_at by a trigger). Until visible_from, only the group's organisers and admins can see the game:
--     row-level security on games/registrations and every player-facing function treat it as not found.
--     Visibility is time-based, so no job is needed to publish a game.
--   * Optional court booking fee: games.fee_total_cents (SGD only for now), paid by PayNow to the organiser or
--     a nominated +65 mobile (public.game_payees, function access only).
--     Estimated share = total / current playing members (waitlist excluded), rounded up to the cent.
--     Final share   = total / attendance list (playing at the start + late joiners) minus players marked Excused;
--                     unexcused no-shows still pay. Final once the game has ended and everyone is marked.
--   * Slot confirmation (paid games): from 00:00 on the game date (group time zone) until the start time,
--     each playing member enters a mobile number (any country code, WhatsApp international format).
--     public.slot_confirmations is readable only through organiser/admin functions, is never logged, is
--     deleted when the player withdraws or the fee is removed, and is purged 30 days after the game.
--   * Existing read/join functions are wrapped (originals moved to the private schema) so their behaviour is
--     unchanged for visible games.

-- ======================= Columns and tables =======================

alter table public.games
  add column visibility text not null default 'now'
    constraint games_visibility_check check (visibility in ('now', 'week_before', 'two_weeks_before')),
  add column visible_from timestamptz,
  add column fee_total_cents int constraint games_fee_total_check check (fee_total_cents between 1 and 999999),
  add column fee_currency text not null default 'SGD' constraint games_fee_currency_check check (fee_currency = 'SGD'),
  add column fee_previous_cents int,
  add column fee_updated_at timestamptz;

create or replace function private.visible_from_for(p_visibility text, p_starts_at timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  -- Hours rather than days, so the result never depends on the session time zone.
  select case p_visibility when 'week_before' then p_starts_at - interval '168 hours'
                           when 'two_weeks_before' then p_starts_at - interval '336 hours' end;
$$;

create or replace function private.set_visible_from()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.visible_from := private.visible_from_for(new.visibility, new.starts_at);
  return new;
end $$;
create trigger games_set_visible_from before insert or update of visibility, starts_at on public.games
for each row execute function private.set_visible_from();

create index games_visible_from_idx on public.games (group_id, visible_from) where visible_from is not null;

create table public.game_payees (
  game_id       uuid primary key references public.games (id) on delete cascade,
  payee_kind    text not null check (payee_kind in ('organiser', 'nominated')),
  payee_user_id uuid references auth.users (id) on delete set null,
  payee_name    text check (payee_name is null or char_length(btrim(payee_name)) between 1 and 60),
  payee_mobile  text not null check (payee_mobile ~ '^\+65[89][0-9]{7}$'),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null,
  check (payee_kind = 'organiser' or payee_name is not null)
);
create table public.slot_confirmations (
  game_id      uuid not null references public.games (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  mobile       text not null check (mobile ~ '^\+[1-9][0-9]{7,14}$'),
  confirmed_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
alter table public.game_payees enable row level security;
alter table public.slot_confirmations enable row level security;
revoke all on public.game_payees, public.slot_confirmations from public, anon, authenticated;

-- ======================= Visibility =======================

create or replace function private.game_hidden(p_visible_from timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p_visible_from is not null and p_visible_from > now();
$$;

-- Organisers and admins see every game in their group; players only games that are visible.
create or replace function private.can_see_game(p_group_id uuid, p_visible_from timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member(p_group_id) and (not private.game_hidden(p_visible_from)
    or private.has_role(p_group_id, array['organiser', 'admin']::public.member_role[]));
$$;

create or replace function private.require_visible_game(p_game_id uuid)
returns public.games language plpgsql stable security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game_id;
  -- A hidden game looks exactly like a missing one, so links reveal nothing.
  if not found or (private.game_hidden(g.visible_from)
     and not private.has_role(g.group_id, array['organiser', 'admin']::public.member_role[])) then
    raise exception 'game_not_found' using errcode = 'P0002';
  end if;
  return g;
end $$;

drop policy games_read on public.games;
create policy games_read on public.games for select to authenticated
  using (private.can_see_game(group_id, visible_from));
drop policy registrations_read on public.registrations;
create policy registrations_read on public.registrations for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and private.can_see_game(g.group_id, g.visible_from)));

-- ======================= Fees =======================

create or replace function private.normalize_mobile(p text)
returns text language sql immutable set search_path = '' as $$
  -- Strips spaces, dots, dashes and brackets; a leading 00 becomes +. Bare digits are left alone (no guessing).
  select case when s like '00%' then '+' || substr(s, 3) else s end
  from (select regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g') as s) x;
$$;

-- Ceiling division in cents: the organiser is never short.
create or replace function private.share_cents(p_total int, p_people int)
returns int language sql immutable set search_path = '' as $$
  select case when p_total is null or coalesce(p_people, 0) < 1 then null else (p_total + p_people - 1) / p_people end;
$$;

create or replace function private.fee_summary(p_game public.games)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_active int; v_basis int; v_unmarked int; v_final boolean := false; v_session boolean;
begin
  if p_game.fee_total_cents is null then return null; end if;
  select count(*) into v_active from public.registrations where game_id = p_game.id and cancelled_at is null;
  v_session := exists (select 1 from public.attendance_sessions s where s.game_id = p_game.id);
  if p_game.starts_at <= now() and v_session then
    select count(*) filter (where status <> 'excused'), count(*) filter (where status = 'unmarked')
      into v_basis, v_unmarked from public.game_attendance where game_id = p_game.id;
    v_final := p_game.ends_at <= now() and v_unmarked = 0 and v_basis > 0;
  else
    v_basis := least(v_active, p_game.capacity);
  end if;
  return jsonb_build_object('total_cents', p_game.fee_total_cents, 'currency', p_game.fee_currency,
    'basis', v_basis, 'share_cents', private.share_cents(p_game.fee_total_cents, v_basis),
    'share_if_full_cents', private.share_cents(p_game.fee_total_cents, p_game.capacity),
    'final', v_final, 'previous_cents', p_game.fee_previous_cents, 'updated_at', p_game.fee_updated_at);
end $$;

-- Payee details: organisers/admins, members currently playing, and anyone still owing on the attendance list.
create or replace function private.payee_json(p_game public.games, p_uid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('kind', y.payee_kind, 'mobile', y.payee_mobile,
    'name', case when y.payee_kind = 'organiser'
                 then coalesce((select pr.display_name from public.profiles pr where pr.user_id = y.payee_user_id), 'Organiser')
                 else y.payee_name end)
  from public.game_payees y
  where y.game_id = p_game.id
    and (private.has_role(p_game.group_id, array['organiser', 'admin']::public.member_role[])
         or private.position_of(p_game.id, p_uid)->>'status' = 'playing'
         or exists (select 1 from public.game_attendance a where a.game_id = p_game.id and a.user_id = p_uid
                    and a.status <> 'excused'));
$$;

-- The confirmation window: 00:00 on the game date in the group's time zone until the start time.
create or replace function private.confirm_window(p_game public.games)
returns tstzrange language sql stable security definer set search_path = '' as $$
  select tstzrange((((p_game.starts_at at time zone gr.timezone)::date)::timestamp at time zone gr.timezone),
                   p_game.starts_at, '[)')
  from public.groups gr where gr.id = p_game.group_id;
$$;

create or replace function private.confirmation_json(p_game public.games, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare w tstzrange := private.confirm_window(p_game); v_at timestamptz;
begin
  if p_game.fee_total_cents is null or p_game.status = 'cancelled' then return null; end if;
  select confirmed_at into v_at from public.slot_confirmations where game_id = p_game.id and user_id = p_uid;
  return jsonb_build_object('required', private.position_of(p_game.id, p_uid)->>'status' = 'playing',
    'opens_at', lower(w), 'closes_at', upper(w), 'open', now() <@ w, 'confirmed_at', v_at);
end $$;

create or replace function public.set_game_fee(p_game_id uuid, p_total_cents int, p_payee_kind text default 'organiser',
  p_payee_name text default null, p_payee_mobile text default null, p_currency text default 'SGD')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := private.require_uid(); g public.games; v_mobile text; v_changed boolean;
begin
  g := private.lock_game(p_game_id);
  if not private.has_role(g.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if g.status = 'cancelled' then raise exception 'game_cancelled' using errcode = 'P0001'; end if;
  if p_total_cents is null then
    if g.fee_total_cents is null then return jsonb_build_object('changed', false); end if;
    update public.games set fee_total_cents = null, fee_previous_cents = g.fee_total_cents, fee_updated_at = now(),
           updated_at = now() where id = g.id;
    delete from public.game_payees where game_id = g.id;
    delete from public.slot_confirmations where game_id = g.id;
    perform private.audit(g.group_id, g.id, 'fee_changed', null,
      jsonb_build_object('previous_cents', g.fee_total_cents, 'fee_cents', null));
    return jsonb_build_object('changed', true);
  end if;
  if p_total_cents < 1 or p_total_cents > 999999 then raise exception 'invalid_fee' using errcode = '22023'; end if;
  if coalesce(p_currency, 'SGD') <> 'SGD' then raise exception 'invalid_currency' using errcode = '22023'; end if;
  if p_payee_kind is null or p_payee_kind not in ('organiser', 'nominated') then
    raise exception 'invalid_payee' using errcode = '22023';
  end if;
  v_mobile := private.normalize_mobile(p_payee_mobile);
  if v_mobile ~ '^[89][0-9]{7}$' then v_mobile := '+65' || v_mobile; end if; -- local 8-digit Singapore number
  if v_mobile !~ '^\+65[89][0-9]{7}$' then raise exception 'invalid_paynow_mobile' using errcode = '22023'; end if;
  if p_payee_kind = 'nominated' and char_length(btrim(coalesce(p_payee_name, ''))) not between 1 and 60 then
    raise exception 'invalid_payee_name' using errcode = '22023';
  end if;
  v_changed := g.fee_total_cents is distinct from p_total_cents;
  if v_changed then
    update public.games set fee_total_cents = p_total_cents, fee_currency = 'SGD', fee_previous_cents = g.fee_total_cents,
           fee_updated_at = now(), updated_at = now() where id = g.id;
  end if;
  insert into public.game_payees (game_id, payee_kind, payee_user_id, payee_name, payee_mobile, updated_by)
  values (g.id, p_payee_kind, case when p_payee_kind = 'organiser' then u end,
          case when p_payee_kind = 'nominated' then btrim(p_payee_name) end, v_mobile, u)
  on conflict (game_id) do update set payee_kind = excluded.payee_kind, payee_user_id = excluded.payee_user_id,
    payee_name = excluded.payee_name, payee_mobile = excluded.payee_mobile, updated_at = now(), updated_by = u;
  if v_changed then
    -- Amounts only: payee and phone numbers are never written to the activity log.
    perform private.audit(g.group_id, g.id, 'fee_changed', null,
      jsonb_build_object('previous_cents', g.fee_total_cents, 'fee_cents', p_total_cents));
  end if;
  return jsonb_build_object('changed', v_changed);
end $$;

-- Organisers/admins: payee details for the edit form (includes the number for paid games).
create or replace function public.get_game_fee_settings(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare g public.games;
begin
  perform private.require_uid();
  select * into g from public.games where id = p_game_id;
  if not found then raise exception 'game_not_found' using errcode = 'P0002'; end if;
  if not private.has_role(g.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object('total_cents', g.fee_total_cents, 'currency', g.fee_currency,
    'payee', (select jsonb_build_object('kind', y.payee_kind, 'name', y.payee_name, 'mobile', y.payee_mobile,
                'user_id', y.payee_user_id) from public.game_payees y where y.game_id = g.id));
end $$;

-- ======================= Slot confirmation =======================

create or replace function public.confirm_slot(p_game_id uuid, p_mobile text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := private.require_uid(); g public.games; v_mobile text; v_at timestamptz;
begin
  g := private.require_visible_game(p_game_id);
  if not private.is_member(g.group_id) then raise exception 'not_member' using errcode = '42501'; end if;
  if g.status = 'cancelled' then raise exception 'game_cancelled' using errcode = 'P0001'; end if;
  if g.fee_total_cents is null then raise exception 'confirmation_not_needed' using errcode = 'P0001'; end if;
  if coalesce(private.position_of(g.id, u)->>'status', '') <> 'playing' then
    raise exception 'not_playing' using errcode = 'P0001';
  end if;
  if now() < lower(private.confirm_window(g)) then raise exception 'confirmation_not_open' using errcode = 'P0001'; end if;
  if now() >= g.starts_at then raise exception 'confirmation_closed' using errcode = 'P0001'; end if;
  v_mobile := private.normalize_mobile(p_mobile);
  if v_mobile !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_mobile' using errcode = '22023'; end if;
  insert into public.slot_confirmations (game_id, user_id, mobile) values (g.id, u, v_mobile)
  on conflict (game_id, user_id) do update set mobile = excluded.mobile, confirmed_at = now()
  returning confirmed_at into v_at;
  perform private.audit(g.group_id, g.id, 'slot_confirmed', u); -- no number in the log
  return jsonb_build_object('confirmed_at', v_at);
end $$;

-- Organisers/admins only: everyone currently playing, with their confirmation (if any).
create or replace function public.list_slot_confirmations(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare g public.games;
begin
  perform private.require_uid();
  select * into g from public.games where id = p_game_id;
  if not found then raise exception 'game_not_found' using errcode = 'P0002'; end if;
  if not private.has_role(g.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', x.name, 'avatar_path', x.avatar_path,
             'position', x.pos, 'confirmed_at', c.confirmed_at, 'mobile', c.mobile) order by x.pos)
    from (select r.user_id, coalesce(p.display_name, 'Player') as name, p.avatar_path,
                 row_number() over (order by r.queue_no) as pos
          from public.registrations r left join public.profiles p on p.user_id = r.user_id
          where r.game_id = g.id and r.cancelled_at is null) x
    left join public.slot_confirmations c on c.game_id = g.id and c.user_id = x.user_id
    where x.pos <= g.capacity), '[]'::jsonb);
end $$;

-- A player who withdraws or is removed no longer has a confirmation.
create or replace function private.drop_confirmation_on_withdraw()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    delete from public.slot_confirmations where game_id = new.game_id and user_id = new.user_id;
  end if;
  return null;
end $$;
create trigger slot_confirmation_after_withdraw after update of cancelled_at on public.registrations
for each row execute function private.drop_confirmation_on_withdraw();

create or replace function private.purge_slot_confirmations()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.slot_confirmations c using public.games g
   where g.id = c.game_id and g.ends_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('pickleme-slot-confirmation-purge', '41 18 * * *', 'select private.purge_slot_confirmations()');
  end if;
end $$;

-- ======================= Creating and editing games =======================

drop function public.create_game(uuid, text, timestamptz, timestamptz, text, int, text);
create function public.create_game(p_group_id uuid, p_title text, p_starts_at timestamptz,
  p_ends_at timestamptz, p_location text default '', p_capacity int default null, p_notes text default '',
  p_visibility text default 'now')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_id uuid; v_cap int;
begin
  if not private.has_role(p_group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ends_at <= p_starts_at then raise exception 'invalid_times' using errcode = '22023'; end if;
  if coalesce(p_visibility, 'now') not in ('now', 'week_before', 'two_weeks_before') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  select coalesce(p_capacity, default_capacity) into v_cap from public.groups where id = p_group_id;
  insert into public.games (group_id, title, starts_at, ends_at, location, capacity, notes, created_by, visibility)
  values (p_group_id, btrim(p_title), p_starts_at, p_ends_at, btrim(coalesce(p_location, '')), v_cap,
          coalesce(p_notes, ''), v_uid, coalesce(p_visibility, 'now'))
  returning id into v_id;
  perform private.audit(p_group_id, v_id, 'game_created');
  return v_id;
end;
$$;
revoke all on function public.create_game(uuid, text, timestamptz, timestamptz, text, int, text, text) from public, anon;
grant execute on function public.create_game(uuid, text, timestamptz, timestamptz, text, int, text, text) to authenticated;

drop function public.update_game(uuid, text, timestamptz, timestamptz, text, int, text);
create function public.update_game(p_game_id uuid, p_title text, p_starts_at timestamptz,
  p_ends_at timestamptz, p_location text, p_capacity int, p_notes text, p_visibility text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.games; active_count int; before_ids bigint[]; promoted_count int;
  before_fields jsonb; after_fields jsonb; changes jsonb; v_visibility text;
begin
  perform private.require_uid();
  g := private.lock_game(p_game_id);
  if not private.has_role(g.group_id, array['organiser', 'admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if g.status = 'cancelled' then raise exception 'game_cancelled'; end if;
  if p_ends_at <= p_starts_at then raise exception 'invalid_times' using errcode = '22023'; end if;
  v_visibility := coalesce(p_visibility, g.visibility);
  if v_visibility not in ('now', 'week_before', 'two_weeks_before') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  -- A visible game can't be hidden again (by visibility or a later start) once players have joined.
  if not private.game_hidden(g.visible_from) and private.game_hidden(private.visible_from_for(v_visibility, p_starts_at))
     and exists (select 1 from public.registrations r where r.game_id = g.id and r.cancelled_at is null
                 and not exists (select 1 from public.group_members m where m.group_id = g.group_id
                                 and m.user_id = r.user_id and m.role in ('organiser', 'admin'))) then
    raise exception 'cannot_hide_game_with_players' using errcode = 'P0001';
  end if;
  select count(*) into active_count from public.registrations where game_id = g.id and cancelled_at is null;
  if p_capacity < least(active_count, g.capacity) then raise exception 'capacity_below_attendees'; end if;
  before_ids := private.attendee_reg_ids(g.id);
  before_fields := jsonb_build_object('title', g.title, 'starts_at', g.starts_at, 'ends_at', g.ends_at,
    'location', g.location, 'capacity', g.capacity, 'notes', g.notes, 'visibility', g.visibility);
  update public.games set title = btrim(p_title), starts_at = p_starts_at, ends_at = p_ends_at,
    location = btrim(coalesce(p_location, '')), capacity = p_capacity, notes = coalesce(p_notes, ''),
    visibility = v_visibility, updated_at = now()
    where id = g.id returning jsonb_build_object('title', title, 'starts_at', starts_at, 'ends_at', ends_at,
      'location', location, 'capacity', capacity, 'notes', notes, 'visibility', visibility) into after_fields;
  select coalesce(jsonb_object_agg(e.key, jsonb_build_object('before', e.value, 'after', after_fields->e.key)), '{}'::jsonb)
    into changes from jsonb_each(before_fields) e where e.value is distinct from after_fields->e.key;
  promoted_count := private.record_promotions(g.id, before_ids);
  perform private.audit(g.group_id, g.id, 'game_updated', null, jsonb_build_object(
    'capacity', p_capacity, 'previous_capacity', g.capacity, 'changes', changes));
  return jsonb_build_object('promoted', promoted_count);
end $$;
revoke all on function public.update_game(uuid, text, timestamptz, timestamptz, text, int, text, text) from public, anon;
grant execute on function public.update_game(uuid, text, timestamptz, timestamptz, text, int, text, text) to authenticated;

-- ======================= Player-facing reads and joins (wrapped) =======================

alter function public.get_game(uuid) set schema private;
alter function public.list_games(boolean) set schema private;
alter function public.preview_shared_game(uuid) set schema private;
alter function public.join_game(uuid) set schema private;
alter function public.join_shared_game(uuid) set schema private;
alter function public.get_game_weather(uuid) set schema private;
alter function public.claim_promotion_emails(text, int) set schema private;
revoke all on function private.get_game(uuid), private.list_games(boolean), private.preview_shared_game(uuid),
  private.join_game(uuid), private.join_shared_game(uuid), private.get_game_weather(uuid),
  private.claim_promotion_emails(text, int) from public, anon, authenticated, service_role;

-- join_shared_game calls public.join_game; point it at the original (the wrapper checks visibility first).
do $$
declare src text;
begin
  select pg_get_functiondef('private.join_shared_game(uuid)'::regprocedure) into src;
  src := replace(src, 'public.join_game(p_game_id)', 'private.join_game(p_game_id)');
  execute src;
end $$;

create function public.get_game(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid := private.require_uid(); g public.games; d jsonb; v_role public.member_role;
begin
  g := private.require_visible_game(p_game_id);
  d := private.get_game(p_game_id);
  v_role := (d->>'my_role')::public.member_role;
  return jsonb_set(d, '{game}', (d->'game') || jsonb_build_object(
      'visibility', g.visibility,
      'visible_from', case when v_role in ('organiser', 'admin') then g.visible_from end,
      'fee', case when g.fee_total_cents is null then null else private.fee_summary(g) || jsonb_build_object(
        'payee', private.payee_json(g, u),
        'changed_since_join', exists (select 1 from public.registrations r where r.game_id = g.id and r.user_id = u
                                      and r.cancelled_at is null and r.joined_at < g.fee_updated_at)) end))
    || jsonb_build_object('confirmation', private.confirmation_json(g, u));
end $$;

create function public.list_games(p_include_past boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(e || jsonb_build_object('visibility', g.visibility,
      'visible_from', case when private.has_role(g.group_id, array['organiser', 'admin']::public.member_role[])
                           then g.visible_from end,
      'fee', private.fee_summary(g)) order by o), '[]'::jsonb)
  from jsonb_array_elements(private.list_games(p_include_past)) with ordinality as x(e, o)
  join public.games g on g.id = (x.e->>'id')::uuid
  where private.can_see_game(g.group_id, g.visible_from);
$$;

create function public.preview_shared_game(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare g public.games;
begin
  perform private.require_uid();
  g := private.require_visible_game(p_game_id);
  return private.preview_shared_game(p_game_id) || jsonb_build_object('fee', private.fee_summary(g));
end $$;

create function public.join_game(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_uid();
  perform private.require_visible_game(p_game_id);
  return private.join_game(p_game_id);
end $$;

create function public.join_shared_game(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_uid();
  perform private.require_visible_game(p_game_id);
  return private.join_shared_game(p_game_id);
end $$;

create function public.get_game_weather(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_uid();
  perform private.require_visible_game(p_game_id);
  return private.get_game_weather(p_game_id);
end $$;

-- Promotion emails carry the fee summary so the email can show the cost line.
create function public.claim_promotion_emails(p_secret text, p_limit int default 20)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(e || jsonb_build_object('fee', private.fee_summary(g)) order by o), '[]'::jsonb)
  from jsonb_array_elements(private.claim_promotion_emails(p_secret, p_limit)) with ordinality as x(e, o)
  join public.games g on g.id = (x.e->>'game_id')::uuid;
$$;

revoke all on function public.get_game(uuid), public.list_games(boolean), public.preview_shared_game(uuid),
  public.join_game(uuid), public.join_shared_game(uuid), public.get_game_weather(uuid),
  public.set_game_fee(uuid, int, text, text, text, text), public.get_game_fee_settings(uuid),
  public.confirm_slot(uuid, text), public.list_slot_confirmations(uuid) from public, anon;
grant execute on function public.get_game(uuid), public.list_games(boolean), public.preview_shared_game(uuid),
  public.join_game(uuid), public.join_shared_game(uuid), public.get_game_weather(uuid),
  public.set_game_fee(uuid, int, text, text, text, text), public.get_game_fee_settings(uuid),
  public.confirm_slot(uuid, text), public.list_slot_confirmations(uuid) to authenticated;
revoke all on function public.claim_promotion_emails(text, int) from public;
grant execute on function public.claim_promotion_emails(text, int) to anon, service_role;

revoke all on function private.visible_from_for(text, timestamptz), private.set_visible_from(),
  private.game_hidden(timestamptz), private.can_see_game(uuid, timestamptz), private.require_visible_game(uuid),
  private.normalize_mobile(text), private.share_cents(int, int), private.fee_summary(public.games),
  private.payee_json(public.games, uuid), private.confirm_window(public.games),
  private.confirmation_json(public.games, uuid), private.drop_confirmation_on_withdraw(),
  private.purge_slot_confirmations() from public, anon;
-- RLS policies run as the caller, so the policy helper must be executable.
grant execute on function private.can_see_game(uuid, timestamptz), private.game_hidden(timestamptz) to authenticated;

-- ======================= Activity log =======================

create or replace function private.activity_details(p_action text,p_details jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select case p_action
    when 'game_updated' then jsonb_strip_nulls(jsonb_build_object('changes',p_details->'changes',
      'capacity',p_details->'capacity','previous_capacity',p_details->'previous_capacity'))
    when 'game_deleted' then jsonb_strip_nulls(jsonb_build_object('registrations',p_details->'registrations'))
    when 'role_changed' then jsonb_strip_nulls(jsonb_build_object('role',p_details->'role'))
    when 'attendance_changed' then jsonb_strip_nulls(jsonb_build_object('previous',p_details->'previous','status',p_details->'status'))
    when 'group_renamed' then jsonb_strip_nulls(jsonb_build_object('old_name',p_details->'old_name','new_name',p_details->'new_name'))
    when 'promoted' then jsonb_strip_nulls(jsonb_build_object('count',p_details->'count','triggered_by',p_details->'triggered_by'))
    when 'verification_resent' then jsonb_strip_nulls(jsonb_build_object('masked_email',p_details->'masked_email'))
    when 'pending_signup_dismissed' then jsonb_strip_nulls(jsonb_build_object('masked_email',p_details->'masked_email'))
    when 'status_cancelled' then jsonb_strip_nulls(jsonb_build_object('reason',p_details->'reason','reason_code',p_details->'reason_code'))
    when 'cancel_reason_updated' then jsonb_strip_nulls(jsonb_build_object('changes',jsonb_build_object(
      'cancel_reason',jsonb_build_object('before',p_details->'previous_reason','after',p_details->'reason'))))
    -- FR-021: amounts only. Payee and slot-confirmation numbers are never stored in or returned from the log.
    when 'fee_changed' then jsonb_build_object('changes',jsonb_build_object('court_fee',jsonb_build_object(
      'before',case when p_details->>'previous_cents' is null then 'None'
                    else 'SGD ' || to_char((p_details->>'previous_cents')::numeric / 100, 'FM999990.00') end,
      'after',case when p_details->>'fee_cents' is null then 'None'
                   else 'SGD ' || to_char((p_details->>'fee_cents')::numeric / 100, 'FM999990.00') end)))
    else '{}'::jsonb end;
$$;
revoke all on function private.activity_details(text,jsonb) from public,anon,authenticated;
