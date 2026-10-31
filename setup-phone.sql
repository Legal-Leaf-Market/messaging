-- Crossroads Private Line, part 4: ring people's real phones. Run after setup-push.sql.
-- If an in-app call isn't answered within a few seconds, the "push" function has Twilio
-- dial the person's own phone number, so it rings in their normal Phone app and tells
-- them who is calling and to open Private Line. The call itself stays in the app.

-- Phone numbers are private: kept in their own table, not on profiles (everyone can read
-- profiles). RLS on with no policies, so only the server and the two functions below touch it.
create table if not exists public.phone_numbers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  updated_at timestamptz not null default now()
);
alter table public.phone_numbers enable row level security;
revoke all on public.phone_numbers from anon, authenticated;

-- Save or clear your own number (E.164, e.g. +18125550123). Empty or null removes it.
create or replace function public.set_my_phone(p_phone text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_phone is null or btrim(p_phone) = '' then
    delete from phone_numbers where user_id = auth.uid();
    return null;
  end if;
  insert into phone_numbers (user_id, phone) values (auth.uid(), btrim(p_phone))
  on conflict (user_id) do update set phone = excluded.phone, updated_at = now();
  return btrim(p_phone);
end $$;

-- Read your own number back (nobody else's).
create or replace function public.get_my_phone()
returns text language sql security definer set search_path = public as $$
  select phone from phone_numbers where user_id = auth.uid();
$$;

revoke execute on function public.set_my_phone(text) from public, anon;
revoke execute on function public.get_my_phone() from public, anon;
grant execute on function public.set_my_phone(text) to authenticated;
grant execute on function public.get_my_phone() to authenticated;
