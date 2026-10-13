-- Crossroads Private Line — part 2: ringing + push notifications. Run after setup.sql.

create extension if not exists pg_net;

-- The answering device tells the caller where to connect.
alter table public.calls add column if not exists callee_peer text;

-- Devices that want alerts (one row per phone/browser)
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- Server-only settings (the push signing key). RLS on, no policies = only the server can read it.
create table if not exists public.push_config (key text primary key, value jsonb not null);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language sql security definer set search_path = public as $$
  insert into push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
$$;
create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
revoke execute on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- New message / incoming call / missed call -> ask the "push" function to alert the other person.
create or replace function public.push_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if tg_table_name = 'messages' then t := 'message';
  elsif tg_op = 'INSERT' then t := 'call';
  elsif new.status = 'missed' and old.status = 'ringing' then t := 'missed';
  else return new;
  end if;
  perform net.http_post(
    url := 'https://xppyedslhbrnqnymaaxb.supabase.co/functions/v1/push',
    body := jsonb_build_object('type', t, 'id', new.id),
    -- forward the signed-in sender's own token so the function's login check passes
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', coalesce(current_setting('request.headers', true)::jsonb ->> 'authorization', '')
    )
  );
  return new;
exception when others then
  return new; -- an alert problem must never block a message or call
end $$;
revoke execute on function public.push_notify() from public, anon, authenticated;

drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages
  for each row execute function public.push_notify();
drop trigger if exists calls_push on public.calls;
create trigger calls_push after insert or update of status on public.calls
  for each row execute function public.push_notify();
