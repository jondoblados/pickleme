-- CI-only disposable PostgreSQL database. Never run this bootstrap on Supabase/production.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key,email text,aud text,role text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'),'')::uuid;
$$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create publication supabase_realtime;
