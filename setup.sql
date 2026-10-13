-- Crossroads Private Line — run this ONCE in Supabase: SQL Editor > New query > paste > Run
-- Creates: line profiles, messages, call log, security rules, realtime, and the 24-hour auto-delete job.

create extension if not exists pg_cron;

-- ── Lines (one per login) ─────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- Every user you add in Authentication gets a line automatically.
-- Username = the part of the email before "@".
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, lower(split_part(new.email, '@', 1)), split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any users that already exist
insert into public.profiles (id, username, display_name)
select id, lower(split_part(email, '@', 1)), split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- ── Messages ──────────────────────────────────────────────────────────
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  recipient uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages (created_at);
create index if not exists messages_pair_idx on public.messages (sender, recipient);

-- ── Call log ──────────────────────────────────────────────────────────
create table if not exists public.calls (
  id bigint generated always as identity primary key,
  caller uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  callee uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('audio', 'video')),
  status text not null default 'ringing'
    check (status in ('ringing', 'answered', 'missed', 'declined', 'ended')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index if not exists calls_started_idx on public.calls (started_at);

-- Server always stamps the time, so nobody can make a message live longer than 24h.
create or replace function public.stamp_now() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'messages' then
    new.created_at := now(); new.sender := auth.uid();
  else
    new.started_at := now(); new.caller := auth.uid(); new.status := 'ringing';
  end if;
  return new;
end $$;
drop trigger if exists messages_stamp on public.messages;
create trigger messages_stamp before insert on public.messages for each row execute function public.stamp_now();
drop trigger if exists calls_stamp on public.calls;
create trigger calls_stamp before insert on public.calls for each row execute function public.stamp_now();

-- Call updates may only change status / answered_at / ended_at.
create or replace function public.lock_call_fields() returns trigger language plpgsql as $$
begin
  new.caller := old.caller; new.callee := old.callee;
  new.kind := old.kind; new.started_at := old.started_at;
  return new;
end $$;
drop trigger if exists calls_lock on public.calls;
create trigger calls_lock before update on public.calls for each row execute function public.lock_call_fields();

-- ── Security: each line only sees its own conversations ──────────────
alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.calls    enable row level security;

drop policy if exists "lines visible to members" on public.profiles;
create policy "lines visible to members" on public.profiles for select to authenticated using (true);
drop policy if exists "edit own name" on public.profiles;
create policy "edit own name" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "read own messages" on public.messages;
create policy "read own messages" on public.messages for select to authenticated
  using ((sender = auth.uid() or recipient = auth.uid()) and created_at > now() - interval '24 hours');
drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (sender = auth.uid() and recipient <> auth.uid());
drop policy if exists "clear own conversations" on public.messages;
create policy "clear own conversations" on public.messages for delete to authenticated
  using (sender = auth.uid() or recipient = auth.uid());

drop policy if exists "read own calls" on public.calls;
create policy "read own calls" on public.calls for select to authenticated
  using ((caller = auth.uid() or callee = auth.uid()) and started_at > now() - interval '24 hours');
drop policy if exists "start calls" on public.calls;
create policy "start calls" on public.calls for insert to authenticated
  with check (caller = auth.uid() and callee <> auth.uid());
drop policy if exists "update own calls" on public.calls;
create policy "update own calls" on public.calls for update to authenticated
  using (caller = auth.uid() or callee = auth.uid());
drop policy if exists "clear own calls" on public.calls;
create policy "clear own calls" on public.calls for delete to authenticated
  using (caller = auth.uid() or callee = auth.uid());

-- ── Live updates ──────────────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.calls;
exception when duplicate_object then null; end $$;

-- ── Auto-delete: wipe anything older than 24h, every 5 minutes ───────
-- (The app also hides anything past 24h instantly, so it never shows even between runs.)
select cron.unschedule('purge-24h') where exists (select 1 from cron.job where jobname = 'purge-24h');
select cron.schedule('purge-24h', '*/5 * * * *', $job$
  delete from public.messages where created_at < now() - interval '24 hours';
  delete from public.calls    where started_at < now() - interval '24 hours';
$job$);
