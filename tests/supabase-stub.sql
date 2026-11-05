-- Stands in for what Supabase provides, so the real setup scripts can run on plain Postgres.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema net; create schema cron; create schema storage;
grant usage on schema auth, storage, net to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated;
-- Supabase hands every new public table, sequence and function to these roles by default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as $$ select 1::bigint $$;
grant execute on function net.http_post(text, jsonb, jsonb) to anon, authenticated;
create table cron.job (jobname text);
create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
create publication supabase_realtime;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated;
