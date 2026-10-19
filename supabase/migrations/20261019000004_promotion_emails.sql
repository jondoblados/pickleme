-- FR-004 Promotion emails.
-- Flow: a promotion inserts into notification_outbox -> statement trigger calls the `send-promotions` Edge Function
-- via pg_net -> the function claims due rows, re-checks eligibility, sends via Resend, and records the result.
-- A pg_cron sweep every 2 minutes retries failures and catches anything missed.
-- The function authenticates to the database with a random shared secret kept in Vault (never in the repo).

create extension if not exists pg_net;
create extension if not exists pg_cron;

alter table public.notification_outbox
  add column status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  add column claimed_at timestamptz,
  add column next_attempt_at timestamptz not null default now(),
  add column provider_message_id text,
  add column skipped_reason text;

drop index if exists public.notification_outbox_pending_idx;
create index notification_outbox_due_idx on public.notification_outbox (next_attempt_at)
  where status in ('pending', 'sending');

-- Shared secret + function URL in Vault.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'pickleme_outbox_secret',
                           'Shared secret between the database and the send-promotions Edge Function');
select vault.create_secret('https://bzxkbulljurizjrpixdm.supabase.co/functions/v1/send-promotions',
                           'pickleme_send_promotions_url', 'send-promotions Edge Function URL');

create or replace function private.outbox_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_secret, '') <> '' and p_secret = (
    select decrypted_secret from vault.decrypted_secrets where name = 'pickleme_outbox_secret');
$$;

-- Claim up to p_limit due emails. Ineligible rows are marked skipped and not returned.
create or replace function public.claim_promotion_emails(p_secret text, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_out jsonb; v_ids bigint[];
begin
  if not private.outbox_secret_ok(p_secret) then raise exception 'forbidden' using errcode = '42501'; end if;

  with due as (
    select o.id from public.notification_outbox o
    where o.kind = 'promoted'
      and ((o.status = 'pending' and o.next_attempt_at <= now())
           or (o.status = 'sending' and o.claimed_at < now() - interval '10 minutes'))
    order by o.created_at
    limit least(greatest(p_limit, 1), 50)
    for update skip locked
  )
  , claimed as (
    update public.notification_outbox o
       set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
      from due where o.id = due.id
    returning o.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from claimed;

  -- Re-check eligibility at send time.
  update public.notification_outbox o
     set status = 'skipped',
         skipped_reason = case
           when g.status = 'cancelled' then 'game_cancelled'
           when g.ends_at <= now() then 'game_finished'
           when r.cancelled_at is not null then 'no_longer_registered'
           else 'no_longer_playing' end
    from public.games g, public.registrations r
   where o.id = any (v_ids)
     and g.id = o.game_id and r.id = o.registration_id
     and (g.status = 'cancelled' or g.ends_at <= now() or r.cancelled_at is not null
          or coalesce(private.position_of(o.game_id, o.user_id)->>'status', '') <> 'playing');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'email', u.email, 'display_name', coalesce(p.display_name, 'there'),
           'game_id', g.id, 'title', g.title, 'starts_at', g.starts_at, 'ends_at', g.ends_at,
           'location', g.location, 'notes', g.notes, 'timezone', gr.timezone, 'group_name', gr.name,
           'position', (private.position_of(o.game_id, o.user_id)->>'position')::int,
           'attempt', o.attempts)
         order by o.created_at), '[]'::jsonb)
    into v_out
    from public.notification_outbox o
    join auth.users u on u.id = o.user_id
    left join public.profiles p on p.user_id = o.user_id
    join public.games g on g.id = o.game_id
    join public.groups gr on gr.id = g.group_id
   where o.id = any (v_ids) and o.status = 'sending' and u.email is not null;
  return v_out;
end;
$$;

-- Record the outcome. Failures retry with exponential backoff (2, 4, 8, 16 min); after 5 attempts -> failed.
create or replace function public.complete_promotion_email(p_secret text, p_id bigint, p_ok boolean,
                                                           p_error text default null, p_message_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.outbox_secret_ok(p_secret) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_ok then
    update public.notification_outbox
       set status = 'sent', sent_at = now(), provider_message_id = p_message_id, last_error = null
     where id = p_id and status = 'sending';
  else
    update public.notification_outbox
       set status = case when attempts >= 5 then 'failed' else 'pending' end,
           next_attempt_at = now() + make_interval(mins => power(2, attempts)::int),
           last_error = left(coalesce(p_error, 'unknown error'), 500)
     where id = p_id and status = 'sending';
  end if;
end;
$$;

-- Put claimed rows back without using up an attempt (e.g. email provider not configured yet).
create or replace function public.release_promotion_emails(p_secret text, p_ids bigint[], p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.outbox_secret_ok(p_secret) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.notification_outbox
     set status = 'pending', attempts = greatest(attempts - 1, 0),
         next_attempt_at = now() + interval '5 minutes', last_error = left(p_reason, 500)
   where id = any (p_ids) and status = 'sending';
end;
$$;

revoke all on function public.claim_promotion_emails(text, int) from public;
revoke all on function public.complete_promotion_email(text, bigint, boolean, text, text) from public;
revoke all on function public.release_promotion_emails(text, bigint[], text) from public;
grant execute on function public.claim_promotion_emails(text, int) to anon, service_role;
grant execute on function public.complete_promotion_email(text, bigint, boolean, text, text) to anon, service_role;
grant execute on function public.release_promotion_emails(text, bigint[], text) to anon, service_role;
revoke all on function private.outbox_secret_ok(text) from public, anon, authenticated;

-- Kick the Edge Function (async, after commit).
create or replace function private.kick_send_promotions()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'pickleme_send_promotions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'pickleme_outbox_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := v_url, body := '{}'::jsonb,
                        headers := jsonb_build_object('content-type', 'application/json', 'x-outbox-secret', v_secret),
                        timeout_milliseconds := 10000);
end;
$$;
revoke all on function private.kick_send_promotions() from public, anon, authenticated;

create or replace function private.on_outbox_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.kick_send_promotions();
  return null;
end;
$$;

create trigger notification_outbox_kick
  after insert on public.notification_outbox
  for each statement execute function private.on_outbox_insert();

-- Retry sweep every 2 minutes (only calls out when something is due).
select cron.schedule('pickleme-send-promotions', '*/2 * * * *', $$
  select private.kick_send_promotions()
  where exists (select 1 from public.notification_outbox
                where (status = 'pending' and next_attempt_at <= now())
                   or (status = 'sending' and claimed_at < now() - interval '10 minutes'));
$$);
