-- Minimal stand-ins for the Supabase pg_net, pg_cron and vault extensions, for disposable CI databases only.
create schema if not exists net; create schema if not exists cron; create schema if not exists vault;
create table if not exists net.calls(id bigserial, url text, body jsonb, at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ insert into net.calls(url,body) values (url,body) returning id $$;
create table if not exists cron.job(jobid bigserial, jobname text unique, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values (n,s,c) on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid $$;
create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname=n returning true $$;
create table if not exists vault.secrets(id uuid default gen_random_uuid(), secret text, name text unique, description text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create or replace function vault.create_secret(s text, n text default null, d text default null) returns uuid language sql as $$ insert into vault.secrets(secret,name,description) values (s,n,d) returning id $$;
create table if not exists net.http_request_queue(id bigserial);
