-- Crossroads Private Line, part 3: editable names. Run after setup.sql and setup-push.sql.
-- The app's Name button already works with setup.sql; this makes it safer and fixes two names.

-- Signed-in users may change only their own display_name (not username or id), 1 to 40 characters.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
do $$ begin
  alter table public.profiles add constraint display_name_length
    check (char_length(btrim(display_name)) between 1 and 40);
exception when duplicate_object then null; end $$;

-- Capitalize the two newest lines (Jake, Terry and Nick are already right).
update public.profiles set display_name = 'Corey'   where username = 'corey';
update public.profiles set display_name = 'Kirsten' where username = 'kirsten';
