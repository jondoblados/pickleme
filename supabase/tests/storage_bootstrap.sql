-- Minimal stand-in for Supabase Storage tables, for the disposable CI database only.
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner_id text, created_at timestamptz default now(), updated_at timestamptz default now(),
  metadata jsonb, unique (bucket_id, name));
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1 : array_length(_parts,1) - 1]; end $$;
grant usage on schema storage to authenticated, anon;
grant select, insert, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
