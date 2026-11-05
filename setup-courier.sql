-- Private Line Courier, part 5: orders, quotes, dispatch, NDA, GPS. Run after setup-phone.sql.
-- Safe to run again. It keeps every existing line working: everyone already on Private Line
-- becomes an internal driver, and jake becomes the owner.
--
-- The security idea: nothing here is readable with a plain table query. Every table has row
-- level security on and no grants, and people reach data only through the cc_ functions below,
-- which shape what comes back by role. Senders and receivers never see the internal lines,
-- other customers, or the driver's other jobs.

-- ── Tables ────────────────────────────────────────────────────────────────
create table if not exists public.cc_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'client' check (kind in ('client', 'store')),
  supplier_slug text,
  contact_name text,
  phone text,
  email text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cc_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'pending'
    check (role in ('pending', 'owner', 'dispatcher', 'driver', 'client', 'store')),
  org_id uuid references public.cc_orgs(id) on delete set null,
  active boolean not null default true,
  on_duty boolean not null default false,
  vehicle text,
  created_at timestamptz not null default now()
);

create table if not exists public.cc_nda_versions (
  version text primary key,
  body text not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.cc_nda_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  org_id uuid references public.cc_orgs(id) on delete set null,
  version text not null references public.cc_nda_versions(version),
  body_sha256 text not null,
  typed_name text not null,
  title text,
  company text,
  user_agent text,
  accepted_at timestamptz not null default now()
);
create index if not exists cc_nda_user_idx on public.cc_nda_acceptances (user_id, version);

create table if not exists public.cc_access_requests (
  id bigint generated always as identity primary key,
  company text not null,
  contact text not null,
  email text,
  phone text,
  kind text not null default 'client' check (kind in ('client', 'store', 'driver')),
  note text,
  status text not null default 'new' check (status in ('new', 'approved', 'declined')),
  created_at timestamptz not null default now()
);

create sequence if not exists public.cc_order_seq start 1001;

create table if not exists public.cc_orders (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('PL-' || nextval('public.cc_order_seq')),
  kind text not null default 'courier' check (kind in ('courier', 'purchase', 'process', 'transfer')),
  status text not null default 'requested' check (status in
    ('requested', 'quoted', 'approved', 'declined', 'dispatching', 'assigned', 'in_progress', 'delivered', 'closed', 'cancelled')),
  urgency text not null default 'same_day' check (urgency in ('hotshot', 'same_day', 'next_day', 'scheduled')),
  org_id uuid references public.cc_orgs(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  driver_id uuid references public.profiles(id) on delete set null,
  title text,
  notes text,
  blind boolean not null default true,
  need_by timestamptz,
  invoice_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cc_orders_org_idx on public.cc_orders (org_id, created_at desc);
create index if not exists cc_orders_status_idx on public.cc_orders (status, created_at desc);
create index if not exists cc_orders_driver_idx on public.cc_orders (driver_id, status);

create table if not exists public.cc_stops (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.cc_orders(id) on delete cascade,
  seq int not null,
  kind text not null check (kind in ('pickup', 'process', 'drop')),
  place_name text not null,
  address text,
  supplier_slug text,
  contact text,
  instructions text,
  lat double precision,
  lng double precision,
  status text not null default 'pending' check (status in ('pending', 'arrived', 'done', 'skipped')),
  arrived_at timestamptz,
  done_at timestamptz,
  received_by text,
  note text,
  done_lat double precision,
  done_lng double precision,
  unique (order_id, seq)
);

create table if not exists public.cc_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.cc_orders(id) on delete cascade,
  seq int not null default 0,
  action text not null default 'pickup' check (action in ('buy', 'pickup', 'process')),
  supplier_slug text,
  supplier_name text,
  description text not null,
  part_no text,
  qty numeric not null default 1 check (qty > 0),
  store_org_id uuid references public.cc_orgs(id) on delete set null,
  store_status text not null default 'none' check (store_status in ('none', 'asked', 'confirmed', 'declined')),
  store_price_cents int check (store_price_cents is null or store_price_cents >= 0),
  store_note text
);
create index if not exists cc_items_store_idx on public.cc_items (store_org_id, store_status);

create table if not exists public.cc_quotes (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.cc_orders(id) on delete cascade,
  parts_cents int not null default 0 check (parts_cents >= 0),
  purchase_fee_cents int not null default 0 check (purchase_fee_cents >= 0),
  courier_cents int not null default 0 check (courier_cents >= 0),
  rush_cents int not null default 0 check (rush_cents >= 0),
  total_cents int generated always as (parts_cents + purchase_fee_cents + courier_cents + rush_cents) stored,
  note text,
  valid_until timestamptz not null,
  status text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'superseded')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references public.profiles(id) on delete set null,
  response_note text
);

-- Append-only custody log. There is no update or delete path for this table.
create table if not exists public.cc_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.cc_orders(id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid references public.profiles(id) on delete set null,
  actor_role text,
  type text not null,
  detail jsonb not null default '{}'::jsonb,
  client_visible boolean not null default true
);
create index if not exists cc_events_order_idx on public.cc_events (order_id, id);

create table if not exists public.cc_order_messages (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.cc_orders(id) on delete cascade,
  sender uuid references public.profiles(id) on delete set null,
  sender_side text not null check (sender_side in ('client', 'internal')),
  internal boolean not null default false,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.cc_attachments (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.cc_orders(id) on delete cascade,
  stop_id uuid references public.cc_stops(id) on delete set null,
  kind text not null check (kind in ('proof', 'drawing', 'po')),
  path text unique not null,
  name text not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.cc_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.cc_orders(id) on delete cascade,
  title text not null,
  body text not null,
  urgent boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cc_notifications_user_idx on public.cc_notifications (user_id, id desc);

-- One row per on-duty driver: the latest position only, no location history.
create table if not exists public.cc_driver_pos (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m double precision,
  heading double precision,
  speed_mps double precision,
  at timestamptz not null default now()
);

-- Lock every table. Reads and writes go through the functions below.
do $$ declare t text; begin
  foreach t in array array['cc_orgs','cc_members','cc_nda_versions','cc_nda_acceptances','cc_access_requests',
    'cc_orders','cc_stops','cc_items','cc_quotes','cc_events','cc_order_messages','cc_attachments','cc_notifications','cc_driver_pos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.cc_order_seq from anon, authenticated;

-- People may read their own alerts, which is what the live feed needs.
grant select on public.cc_notifications to authenticated;
drop policy if exists "read own alerts" on public.cc_notifications;
create policy "read own alerts" on public.cc_notifications for select to authenticated
  using (user_id = auth.uid());

-- ── The NDA text ─────────────────────────────────────────────────────────
-- DRAFT for attorney review. scripts/build-courier.mjs copies this text into the page's demo.
insert into public.cc_nda_versions (version, body, is_current) values ('2026-11-draft-1', $nda$
MUTUAL NON-DISCLOSURE AGREEMENT

This agreement is between Private Line Courier ("the Courier") and the person or company accepting it ("the Member"). It applies each time either side shares Confidential Information to arrange, carry out or pay for a delivery, purchase, or transfer through this service.

1. What is confidential. Confidential Information means non-public information one side gives the other in connection with the service. It includes customer and supplier identities, drawings, specifications, part numbers, quantities, prices, delivery locations, schedules, and the contents of any package.

2. What is not confidential. It does not include information that is already public through no fault of the receiving side, was already lawfully known to the receiving side, was lawfully received from someone else without a duty of confidence, or was developed independently without using Confidential Information.

3. Duties. The receiving side will use Confidential Information only to perform or receive the service, will not disclose it except to people who need it for that purpose and are bound by similar duties, and will protect it with at least reasonable care. Drivers will not open sealed packages, photograph contents, or discuss jobs outside the service, except that a driver may photograph the outside of a package and the place of delivery as proof of delivery.

4. Blind handling. Unless the Member turns it off for an order, the Courier will not tell drivers or suppliers who the customer is, except where a supplier, the law or the job itself requires it.

5. Records. The Courier keeps job records, including order details, custody events, receiver names, and proof of delivery photos, for its legal, insurance, tax and accounting needs. These records stay subject to this agreement.

6. Disclosures required by law. Either side may disclose Confidential Information when required by law, subpoena, court order, or a government agency with authority to require it. Where the law allows, that side will give prompt notice first so the other side can seek protection, and will disclose only what is required.

7. Reporting a suspected violation of law. Nothing in this agreement stops anyone from reporting a suspected violation of law to a government agency or from cooperating with one. Under 18 U.S.C. 1833(b), an individual will not be held criminally or civilly liable under any federal or state trade secret law for disclosing a trade secret (a) in confidence to a federal, state or local government official, or to an attorney, solely to report or investigate a suspected violation of law, or (b) in a complaint or other document filed under seal in a lawsuit or other proceeding. An individual who files a lawsuit for retaliation for reporting a suspected violation of law may disclose the trade secret to their attorney and use it in the court proceeding, if any document containing the trade secret is filed under seal and it is not disclosed except by court order.

8. Lawful goods only. This agreement does not cover or conceal any unlawful activity. The Member will not tender goods the Courier's no carry list excludes. The Courier may refuse, stop, or report any shipment it reasonably believes is unlawful.

9. No rights granted. All Confidential Information stays the property of the side that shared it. This agreement gives no license or ownership.

10. Term. These duties begin on acceptance and last three years after the Member's last order, and for trade secrets for as long as the information remains a trade secret. On written request, the receiving side will return or destroy Confidential Information, except for the records described in section 5.

11. Remedies. A breach may cause harm that money cannot fully repair, so either side may ask a court for an injunction in addition to any other remedy.

12. General. Indiana law governs this agreement, and the state and federal courts in Bartholomew County, Indiana, have jurisdiction. Electronic acceptance has the same effect as a signature. This agreement does not create a partnership or agency, and it can be changed only by a new version that the Member accepts.
$nda$, true)
on conflict (version) do nothing;

-- ── Helpers ──────────────────────────────────────────────────────────────
create or replace function public.cc_role(u uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select case when active then role else 'pending' end from cc_members where user_id = u), 'pending');
$$;

create or replace function public.cc_is_internal(u uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select cc_role(u) in ('owner', 'dispatcher', 'driver');
$$;

create or replace function public.cc_is_dispatch(u uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select cc_role(u) in ('owner', 'dispatcher');
$$;

create or replace function public.cc_nda_ok(u uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cc_nda_acceptances a join cc_nda_versions v on v.version = a.version
                 where a.user_id = u and v.is_current);
$$;

create or replace function public.cc_my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from cc_members where user_id = auth.uid() and active;
$$;

-- Every action starts here: signed in, right role, NDA accepted.
create or replace function public.cc_require(variadic roles text[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare r text := cc_role();
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if r = 'pending' then raise exception 'This login is waiting for approval.'; end if;
  if not r = any(roles) then raise exception 'This login cannot do that.'; end if;
  if not cc_nda_ok() then raise exception 'Accept the NDA first.'; end if;
  return r;
end $$;

create or replace function public.cc_log(p_order uuid, p_type text, p_detail jsonb default '{}'::jsonb, p_client boolean default true)
returns void language sql security definer set search_path = public as $$
  insert into cc_events (order_id, actor, actor_role, type, detail, client_visible)
  values (p_order, auth.uid(), cc_role(), p_type, coalesce(p_detail, '{}'::jsonb), p_client);
$$;

-- Alert text never includes cargo or customer details, because it can show on a lock screen.
create or replace function public.cc_notify(p_user uuid, p_order uuid, p_title text, p_body text, p_urgent boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into cc_notifications (user_id, order_id, title, body, urgent) values (p_user, p_order, p_title, p_body, p_urgent);
$$;

create or replace function public.cc_notify_dispatch(p_order uuid, p_title text, p_body text, p_urgent boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into cc_notifications (user_id, order_id, title, body, urgent)
  select user_id, p_order, p_title, p_body, p_urgent from cc_members where role in ('owner', 'dispatcher') and active;
$$;

create or replace function public.cc_notify_org(p_orgid uuid, p_order uuid, p_title text, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into cc_notifications (user_id, order_id, title, body)
  select user_id, p_order, p_title, p_body from cc_members where org_id = p_orgid and role in ('client', 'store') and active;
$$;

-- Lock the helpers; only the top-level functions at the bottom of this file are callable.
revoke execute on function public.cc_log(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.cc_notify(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.cc_notify_dispatch(uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.cc_notify_org(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.cc_require(text[]) from public, anon, authenticated;

-- ── Internal lines stay internal ─────────────────────────────────────────
-- New logins start pending, and pending and outside logins cannot see or reach anyone on Private Line.
create or replace function public.cc_new_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into cc_members (user_id, role) values (new.id, 'pending') on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists profiles_cc_member on public.profiles;
create trigger profiles_cc_member after insert on public.profiles
  for each row execute function public.cc_new_member();

-- Everyone on Private Line before this script ran is internal. Only the first run does this.
insert into public.cc_members (user_id, role)
select p.id, case when p.username = 'jake' then 'owner' else 'driver' end
from public.profiles p
on conflict (user_id) do nothing;

drop policy if exists "lines visible to members" on public.profiles;
create policy "lines visible to members" on public.profiles for select to authenticated
  using (id = auth.uid() or (public.cc_is_internal(auth.uid()) and public.cc_is_internal(id)));

drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (sender = auth.uid() and recipient <> auth.uid()
    and public.cc_is_internal(auth.uid()) and public.cc_is_internal(recipient));

drop policy if exists "start calls" on public.calls;
create policy "start calls" on public.calls for insert to authenticated
  with check (caller = auth.uid() and callee <> auth.uid()
    and public.cc_is_internal(auth.uid()) and public.cc_is_internal(callee));

-- ── Who am I, and the NDA ────────────────────────────────────────────────
create or replace function public.cc_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m cc_members; p profiles; o cc_orgs;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into p from profiles where id = auth.uid();
  select * into m from cc_members where user_id = auth.uid();
  if m.org_id is not null then select * into o from cc_orgs where id = m.org_id; end if;
  return jsonb_build_object(
    'id', auth.uid(), 'username', p.username, 'display_name', p.display_name,
    'role', cc_role(), 'on_duty', coalesce(m.on_duty, false), 'vehicle', m.vehicle,
    'org', case when o.id is null then null else jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind) end,
    'nda_ok', cc_nda_ok()
  );
end $$;

create or replace function public.cc_current_nda() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('version', version, 'body', body) from cc_nda_versions where is_current limit 1;
$$;

create or replace function public.cc_accept_nda(p_version text, p_typed_name text, p_title text, p_company text, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v cc_nda_versions; n text := btrim(coalesce(p_typed_name, ''));
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if cc_role() = 'pending' then raise exception 'This login is waiting for approval.'; end if;
  select * into v from cc_nda_versions where version = p_version and is_current;
  if v.version is null then raise exception 'That NDA version is out of date. Reload and read the current one.'; end if;
  if char_length(n) < 3 or char_length(n) > 120 then raise exception 'Type your full legal name to accept.'; end if;
  if cc_nda_ok() then return cc_me(); end if;
  insert into cc_nda_acceptances (user_id, org_id, version, body_sha256, typed_name, title, company, user_agent)
  values (auth.uid(), cc_my_org(), v.version, encode(sha256(convert_to(v.body, 'UTF8')), 'hex'), n,
          left(btrim(p_title), 120), left(btrim(p_company), 120), left(p_user_agent, 300));
  return cc_me();
end $$;

-- Open to the public, so it is capped and keeps nothing but what the person typed.
create or replace function public.cc_request_access(p_company text, p_contact text, p_email text, p_phone text, p_kind text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c text := btrim(coalesce(p_company, '')); n text := btrim(coalesce(p_contact, '')); e text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(c) not between 2 and 120 or char_length(n) not between 2 and 120 then
    raise exception 'Add your company and your name.';
  end if;
  if e = '' and btrim(coalesce(p_phone, '')) = '' then raise exception 'Add an email or a phone number.'; end if;
  if p_kind not in ('client', 'store', 'driver') then raise exception 'Pick what you need access for.'; end if;
  if (select count(*) from cc_access_requests where created_at > now() - interval '1 day') >= 50 then
    raise exception 'Too many requests today. Call us instead.';
  end if;
  if e <> '' and exists (select 1 from cc_access_requests where lower(email) = e and created_at > now() - interval '1 day') then
    return jsonb_build_object('ok', true);
  end if;
  insert into cc_access_requests (company, contact, email, phone, kind, note)
  values (c, n, nullif(e, ''), left(btrim(p_phone), 30), p_kind, left(btrim(p_note), 1000));
  insert into cc_notifications (user_id, title, body)
  select user_id, 'New access request', 'Someone asked for access. Open Admin to review it.' from cc_members where role = 'owner' and active;
  return jsonb_build_object('ok', true);
end $$;

-- ── Placing an order ─────────────────────────────────────────────────────
create or replace function public.cc_list_stores() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform cc_require('owner', 'dispatcher', 'driver', 'client', 'store');
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'supplier_slug', supplier_slug) order by name)
    from cc_orgs where kind = 'store' and active and id is distinct from cc_my_org()), '[]'::jsonb);
end $$;

create or replace function public.cc_submit_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r text := cc_require('owner', 'dispatcher', 'client', 'store');
  org uuid := cc_my_org();
  oid uuid; oref text; s jsonb; i jsonb; n int := 0; k text := 'courier';
  urg text := coalesce(p->>'urgency', 'same_day');
  stops jsonb := coalesce(p->'stops', '[]'::jsonb);
  items jsonb := coalesce(p->'items', '[]'::jsonb);
  store_id uuid; drops int; store_ids uuid[] := '{}';
begin
  if r in ('owner', 'dispatcher') and p->>'org_id' is not null then org := (p->>'org_id')::uuid; end if;
  if r in ('client', 'store') and org is null then raise exception 'This login is not tied to a company yet.'; end if;
  if coalesce((p->>'no_prohibited')::boolean, false) is not true then
    raise exception 'Confirm the order has nothing from the no carry list.';
  end if;
  if urg not in ('hotshot', 'same_day', 'next_day', 'scheduled') then raise exception 'Pick how fast this needs to move.'; end if;
  if jsonb_typeof(stops) <> 'array' or jsonb_typeof(items) <> 'array' then raise exception 'That order is not valid.'; end if;
  if jsonb_array_length(stops) not between 2 and 12 then raise exception 'A run needs a pickup and a drop, and at most 12 stops.'; end if;
  if jsonb_array_length(items) > 40 then raise exception 'Keep an order to 40 lines.'; end if;
  select count(*) into drops from jsonb_array_elements(stops) e where e->>'kind' = 'drop';
  if drops < 1 then raise exception 'Add where this gets delivered.'; end if;
  if stops->(jsonb_array_length(stops) - 1)->>'kind' <> 'drop' then raise exception 'The last stop has to be a drop.'; end if;

  insert into cc_orders (urgency, org_id, created_by, title, notes, blind, need_by)
  values (urg, org, auth.uid(), left(btrim(p->>'title'), 120), left(btrim(p->>'notes'), 2000),
          coalesce((p->>'blind')::boolean, true), nullif(p->>'need_by', '')::timestamptz)
  returning id, ref into oid, oref;

  for s in select * from jsonb_array_elements(stops) loop
    n := n + 1;
    if coalesce(s->>'kind', '') not in ('pickup', 'process', 'drop') then raise exception 'That order has a bad stop.'; end if;
    if char_length(btrim(coalesce(s->>'place_name', ''))) not between 1 and 160 then raise exception 'Every stop needs a place name.'; end if;
    insert into cc_stops (order_id, seq, kind, place_name, address, supplier_slug, contact, instructions, lat, lng)
    values (oid, n, s->>'kind', btrim(s->>'place_name'), left(btrim(s->>'address'), 200), left(s->>'supplier_slug', 120),
            left(btrim(s->>'contact'), 120), left(btrim(s->>'instructions'), 600),
            nullif(s->>'lat', '')::double precision, nullif(s->>'lng', '')::double precision);
  end loop;

  n := 0;
  for i in select * from jsonb_array_elements(items) loop
    n := n + 1;
    if char_length(btrim(coalesce(i->>'description', ''))) not between 1 and 500 then raise exception 'Every line needs a description.'; end if;
    if coalesce(i->>'action', 'pickup') not in ('buy', 'pickup', 'process') then raise exception 'That order has a bad line.'; end if;
    if coalesce((i->>'qty')::numeric, 1) <= 0 then raise exception 'Quantities have to be more than zero.'; end if;
    store_id := nullif(i->>'store_org_id', '')::uuid;
    if store_id is not null then
      if store_id = org then raise exception 'Pick a different store than your own.'; end if;
      if not exists (select 1 from cc_orgs where id = store_id and kind = 'store' and active) then
        raise exception 'That store is not in the network.';
      end if;
      store_ids := array_append(store_ids, store_id);
      k := 'transfer';
    elsif k <> 'transfer' then
      if i->>'action' = 'buy' then k := 'purchase';
      elsif i->>'action' = 'process' and k <> 'purchase' then k := 'process'; end if;
    end if;
    insert into cc_items (order_id, seq, action, supplier_slug, supplier_name, description, part_no, qty, store_org_id, store_status)
    values (oid, n, coalesce(i->>'action', 'pickup'), left(i->>'supplier_slug', 120), left(btrim(i->>'supplier_name'), 160),
            btrim(i->>'description'), left(btrim(i->>'part_no'), 80), coalesce((i->>'qty')::numeric, 1),
            store_id, case when store_id is null then 'none' else 'asked' end);
  end loop;

  update cc_orders set kind = k where id = oid;
  perform cc_log(oid, 'order_placed', jsonb_build_object('urgency', urg, 'no_carry_confirmed', true));
  perform cc_notify_dispatch(oid, case when urg = 'hotshot' then 'New hot shot request' else 'New order request' end,
                             oref || ' needs a quote.', urg = 'hotshot');
  if array_length(store_ids, 1) > 0 then
    perform cc_notify_org(x, oid, 'Stock request', 'Another store asked if you can supply a part. Job ' || oref || '.')
    from (select distinct unnest(store_ids) x) q;
  end if;
  return jsonb_build_object('id', oid, 'ref', oref, 'kind', k);
end $$;

-- ── Quotes ───────────────────────────────────────────────────────────────
create or replace function public.cc_send_quote(p_order uuid, p_parts int, p_fee int, p_courier int, p_rush int, p_note text, p_valid_hours int default 24)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o cc_orders; q cc_quotes;
begin
  perform cc_require('owner', 'dispatcher');
  select * into o from cc_orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status not in ('requested', 'quoted') then raise exception 'This order is past the quote stage.'; end if;
  if least(p_parts, p_fee, p_courier, p_rush) < 0 then raise exception 'Amounts cannot be negative.'; end if;
  if coalesce(p_parts, 0) + coalesce(p_fee, 0) + coalesce(p_courier, 0) + coalesce(p_rush, 0) <= 0 then raise exception 'A quote needs a total above zero.'; end if;
  if coalesce(p_valid_hours, 24) not between 1 and 720 then raise exception 'A quote can last from 1 hour to 30 days.'; end if;
  update cc_quotes set status = 'superseded' where order_id = p_order and status = 'sent';
  insert into cc_quotes (order_id, parts_cents, purchase_fee_cents, courier_cents, rush_cents, note, valid_until, created_by)
  values (p_order, coalesce(p_parts, 0), coalesce(p_fee, 0), coalesce(p_courier, 0), coalesce(p_rush, 0), left(btrim(p_note), 1000),
          now() + make_interval(hours => coalesce(p_valid_hours, 24)), auth.uid())
  returning * into q;
  update cc_orders set status = 'quoted', updated_at = now() where id = p_order;
  perform cc_log(p_order, 'quote_sent', jsonb_build_object('total_cents', q.total_cents));
  perform cc_notify_org(o.org_id, p_order, 'Your quote is ready', 'Quote ready on job ' || o.ref || '.');
  return jsonb_build_object('quote_id', q.id, 'total_cents', q.total_cents);
end $$;

-- A customer answers from their login. Dispatch can record an answer given by phone, with a note.
create or replace function public.cc_respond_quote(p_order uuid, p_accept boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r text := cc_require('owner', 'dispatcher', 'client', 'store'); o cc_orders; q cc_quotes; resp text := left(btrim(p_note), 500);
begin
  select * into o from cc_orders where id = p_order for update;
  if o.id is null or (r in ('client', 'store') and o.org_id is distinct from cc_my_org()) then raise exception 'Order not found.'; end if;
  if r in ('owner', 'dispatcher') and coalesce(resp, '') = '' then raise exception 'Add who approved it and how, like "Dana by phone".'; end if;
  if o.status <> 'quoted' then raise exception 'There is no open quote on this order.'; end if;
  select * into q from cc_quotes where order_id = p_order and status = 'sent' order by id desc limit 1;
  if q.id is null then raise exception 'There is no open quote on this order.'; end if;
  if p_accept and q.valid_until < now() then raise exception 'This quote expired. Ask for a new one.'; end if;
  update cc_quotes set status = case when p_accept then 'accepted' else 'declined' end,
    responded_at = now(), responded_by = auth.uid(), response_note = resp where id = q.id;
  update cc_orders set status = case when p_accept then 'approved' else 'declined' end, updated_at = now() where id = p_order;
  perform cc_log(p_order, case when p_accept then 'quote_accepted' else 'quote_declined' end,
                 jsonb_build_object('total_cents', q.total_cents, 'note', resp, 'by_dispatch', r in ('owner', 'dispatcher')));
  perform cc_notify_dispatch(p_order, case when p_accept then 'Quote accepted' else 'Quote declined' end,
                             o.ref || case when p_accept then ' is ready to dispatch.' else ' was declined.' end, p_accept and o.urgency = 'hotshot');
  return jsonb_build_object('status', case when p_accept then 'approved' else 'declined' end);
end $$;

-- ── Dispatch and drivers ─────────────────────────────────────────────────
create or replace function public.cc_set_duty(p_on boolean, p_vehicle text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform cc_require('owner', 'dispatcher', 'driver');
  update cc_members set on_duty = p_on, vehicle = coalesce(left(btrim(p_vehicle), 80), vehicle) where user_id = auth.uid();
  if not p_on then delete from cc_driver_pos where user_id = auth.uid(); end if;
  return cc_me();
end $$;

-- Dispatch one driver, or send a null driver to offer the job to everyone on duty.
create or replace function public.cc_dispatch(p_order uuid, p_driver uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o cc_orders; offered int := 0;
begin
  perform cc_require('owner', 'dispatcher');
  select * into o from cc_orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status not in ('approved', 'dispatching', 'assigned') then raise exception 'This order is not ready to dispatch.'; end if;
  if p_driver is null then
    update cc_orders set status = 'dispatching', driver_id = null, updated_at = now() where id = p_order;
    with m as (select user_id from cc_members where role in ('owner', 'dispatcher', 'driver') and active and on_duty and cc_nda_ok(user_id)),
         ins as (insert into cc_notifications (user_id, order_id, title, body, urgent)
                 select user_id, p_order, case when o.urgency = 'hotshot' then 'Hot shot job open' else 'Job open' end,
                        'Job ' || o.ref || ' is open. First to claim it gets it.', o.urgency = 'hotshot' from m returning 1)
    select count(*) into offered from ins;
    perform cc_log(p_order, 'offered_to_drivers', jsonb_build_object('drivers', offered), false);
    return jsonb_build_object('status', 'dispatching', 'offered', offered);
  end if;
  if cc_role(p_driver) not in ('owner', 'dispatcher', 'driver') then raise exception 'That person is not a driver.'; end if;
  if not cc_nda_ok(p_driver) then raise exception 'That driver has not accepted the NDA yet.'; end if;
  update cc_orders set status = 'assigned', driver_id = p_driver, updated_at = now() where id = p_order;
  perform cc_log(p_order, 'driver_assigned', jsonb_build_object('driver', p_driver));
  perform cc_notify(p_driver, p_order, case when o.urgency = 'hotshot' then 'Hot shot job assigned' else 'Job assigned' end,
                    'Job ' || o.ref || ' is yours.', o.urgency = 'hotshot');
  return jsonb_build_object('status', 'assigned');
end $$;

create or replace function public.cc_claim_job(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o cc_orders;
begin
  perform cc_require('owner', 'dispatcher', 'driver');
  if not (select on_duty from cc_members where user_id = auth.uid()) then raise exception 'Go on duty to claim jobs.'; end if;
  update cc_orders set status = 'assigned', driver_id = auth.uid(), updated_at = now()
    where id = p_order and status = 'dispatching' returning * into o;
  if o.id is null then raise exception 'Someone already claimed that job.'; end if;
  perform cc_log(p_order, 'driver_assigned', jsonb_build_object('driver', auth.uid(), 'claimed', true));
  perform cc_notify_dispatch(p_order, 'Job claimed', o.ref || ' has a driver.');
  return jsonb_build_object('status', 'assigned');
end $$;

create or replace function public.cc_release_job(p_order uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o cc_orders;
begin
  perform cc_require('owner', 'dispatcher', 'driver');
  select * into o from cc_orders where id = p_order for update;
  if o.id is null or o.driver_id is distinct from auth.uid() then raise exception 'That job is not yours.'; end if;
  if o.status <> 'assigned' then raise exception 'You already started this run. Call dispatch.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why you are giving this job back.'; end if;
  update cc_orders set status = 'dispatching', driver_id = null, updated_at = now() where id = p_order;
  perform cc_log(p_order, 'driver_released', jsonb_build_object('reason', left(btrim(p_reason), 300)), false);
  perform cc_notify_dispatch(p_order, 'Job given back', o.ref || ' needs a new driver.', o.urgency = 'hotshot');
  return jsonb_build_object('status', 'dispatching');
end $$;

-- Stops run in order. Each one logs who, when and where, so custody has no gaps.
create or replace function public.cc_stop_update(p_stop uuid, p_action text, p_received_by text default null, p_note text default null,
                                                 p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r text := cc_require('owner', 'dispatcher', 'driver');
  s cc_stops; o cc_orders; nxt int; left_stops int; who text := btrim(coalesce(p_received_by, ''));
  here jsonb := case when p_lat is null or p_lng is null then '{}'::jsonb else jsonb_build_object('lat', p_lat, 'lng', p_lng) end;
begin
  select * into s from cc_stops where id = p_stop for update;
  if s.id is null then raise exception 'Stop not found.'; end if;
  select * into o from cc_orders where id = s.order_id for update;
  if o.driver_id is distinct from auth.uid() and r = 'driver' then raise exception 'That job is not yours.'; end if;
  if o.status not in ('assigned', 'in_progress') then raise exception 'This job is not running.'; end if;
  select min(seq) into nxt from cc_stops where order_id = s.order_id and status in ('pending', 'arrived');
  if s.seq <> nxt then raise exception 'Finish the earlier stop first.'; end if;

  if p_action = 'arrive' then
    if s.status <> 'pending' then raise exception 'You already arrived here.'; end if;
    update cc_stops set status = 'arrived', arrived_at = now() where id = p_stop;
    if o.status = 'assigned' then update cc_orders set status = 'in_progress', updated_at = now() where id = o.id; end if;
    perform cc_log(o.id, 'arrived', jsonb_build_object('stop', s.seq, 'kind', s.kind) || here);
  elsif p_action = 'done' then
    if s.status <> 'arrived' then raise exception 'Mark that you arrived first.'; end if;
    if s.kind = 'drop' and char_length(who) < 2 then raise exception 'Get the name of the person who received it.'; end if;
    update cc_stops set status = 'done', done_at = now(), received_by = nullif(left(who, 120), ''), note = left(btrim(p_note), 500),
      done_lat = p_lat, done_lng = p_lng where id = p_stop;
    perform cc_log(o.id, case s.kind when 'drop' then 'delivered_stop' when 'process' then 'processed' else 'picked_up' end,
                   jsonb_build_object('stop', s.seq, 'received_by', nullif(who, '')) || here);
    select count(*) into left_stops from cc_stops where order_id = s.order_id and status in ('pending', 'arrived');
    if left_stops = 0 then
      update cc_orders set status = 'delivered', updated_at = now() where id = o.id;
      perform cc_log(o.id, 'delivered', jsonb_build_object('received_by', nullif(who, '')));
      perform cc_notify_org(o.org_id, o.id, 'Delivered', 'Job ' || o.ref || ' was delivered.');
      perform cc_notify_dispatch(o.id, 'Delivered', o.ref || ' was delivered and can be billed.');
    elsif s.kind = 'pickup' then
      perform cc_notify_org(o.org_id, o.id, 'Picked up', 'Job ' || o.ref || ' is on the road.');
    end if;
  else
    raise exception 'Unknown stop action.';
  end if;
  return jsonb_build_object('status', (select status from cc_orders where id = o.id));
end $$;

create or replace function public.cc_close_order(p_order uuid, p_invoice text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o cc_orders;
begin
  perform cc_require('owner', 'dispatcher');
  select * into o from cc_orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status <> 'delivered' then raise exception 'Only a delivered job can be closed.'; end if;
  update cc_orders set status = 'closed', invoice_ref = left(btrim(p_invoice), 60), updated_at = now() where id = p_order;
  perform cc_log(p_order, 'closed', jsonb_build_object('invoice', left(btrim(p_invoice), 60)));
  return jsonb_build_object('status', 'closed');
end $$;

create or replace function public.cc_cancel_order(p_order uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r text := cc_require('owner', 'dispatcher', 'client', 'store'); o cc_orders; why text := left(btrim(coalesce(p_reason, '')), 300);
begin
  select * into o from cc_orders where id = p_order for update;
  if o.id is null or (r in ('client', 'store') and o.org_id is distinct from cc_my_org()) then raise exception 'Order not found.'; end if;
  if char_length(why) < 3 then raise exception 'Say why this is being cancelled.'; end if;
  if r in ('client', 'store') and o.status not in ('requested', 'quoted', 'approved') then
    raise exception 'A driver may already be on this. Message dispatch to cancel.';
  end if;
  if o.status in ('delivered', 'closed', 'cancelled', 'declined', 'in_progress') then raise exception 'This order can no longer be cancelled here.'; end if;
  update cc_quotes set status = 'superseded' where order_id = p_order and status = 'sent';
  update cc_items set store_status = 'declined', store_note = coalesce(store_note, 'Job cancelled') where order_id = p_order and store_status = 'asked';
  update cc_orders set status = 'cancelled', updated_at = now() where id = p_order;
  perform cc_log(p_order, 'cancelled', jsonb_build_object('reason', why));
  perform cc_notify_dispatch(p_order, 'Order cancelled', o.ref || ' was cancelled.');
  perform cc_notify_org(o.org_id, p_order, 'Order cancelled', 'Job ' || o.ref || ' was cancelled.');
  if o.driver_id is not null then perform cc_notify(o.driver_id, p_order, 'Job cancelled', 'Job ' || o.ref || ' was cancelled.', true); end if;
  return jsonb_build_object('status', 'cancelled');
end $$;

-- ── Store to store requests ──────────────────────────────────────────────
-- A store sees only its own line: no customer name, no price paid, no other stops.
create or replace function public.cc_store_requests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform cc_require('store');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'ref', o.ref, 'description', i.description, 'part_no', i.part_no, 'qty', i.qty,
      'need_by', o.need_by, 'urgency', o.urgency, 'store_status', i.store_status,
      'store_price_cents', i.store_price_cents, 'store_note', i.store_note, 'created_at', o.created_at
    ) order by (i.store_status = 'asked') desc, o.created_at desc)
    from cc_items i join cc_orders o on o.id = i.order_id
    where i.store_org_id = cc_my_org() and o.created_at > now() - interval '90 days'), '[]'::jsonb);
end $$;

create or replace function public.cc_store_respond(p_item uuid, p_confirm boolean, p_price_cents int, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i cc_items; o cc_orders;
begin
  perform cc_require('store');
  select * into i from cc_items where id = p_item for update;
  if i.id is null or i.store_org_id is distinct from cc_my_org() then raise exception 'Request not found.'; end if;
  if i.store_status <> 'asked' then raise exception 'You already answered this request.'; end if;
  if p_confirm and (p_price_cents is null or p_price_cents < 0) then raise exception 'Add your price.'; end if;
  update cc_items set store_status = case when p_confirm then 'confirmed' else 'declined' end,
    store_price_cents = case when p_confirm then p_price_cents end, store_note = left(btrim(p_note), 500) where id = p_item;
  select * into o from cc_orders where id = i.order_id;
  perform cc_log(o.id, case when p_confirm then 'store_confirmed' else 'store_declined' end, jsonb_build_object('item', i.seq), false);
  perform cc_notify_dispatch(o.id, 'Store answered', 'A store answered on ' || o.ref || '.');
  return jsonb_build_object('store_status', case when p_confirm then 'confirmed' else 'declined' end);
end $$;

-- ── Reading orders, shaped by role ───────────────────────────────────────
create or replace function public.cc_list_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text := cc_require('owner', 'dispatcher', 'driver', 'client', 'store'); org uuid := cc_my_org(); duty boolean;
begin
  if r in ('owner', 'dispatcher') then
    return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object('id', o.id, 'ref', o.ref, 'kind', o.kind, 'status', o.status, 'urgency', o.urgency, 'title', o.title,
        'need_by', o.need_by, 'created_at', o.created_at, 'org_name', g.name, 'driver_name', d.display_name, 'driver_id', o.driver_id,
        'total_cents', (select total_cents from cc_quotes q where q.order_id = o.id and q.status in ('sent', 'accepted') order by q.id desc limit 1),
        'stops', (select count(*) from cc_stops s where s.order_id = o.id),
        'stops_done', (select count(*) from cc_stops s where s.order_id = o.id and s.status = 'done'),
        'store_waiting', (select count(*) from cc_items i where i.order_id = o.id and i.store_status = 'asked')) x
      from cc_orders o left join cc_orgs g on g.id = o.org_id left join profiles d on d.id = o.driver_id
      where o.status not in ('closed', 'cancelled', 'declined') or o.updated_at > now() - interval '14 days'
      order by o.created_at desc limit 300) t), '[]'::jsonb);
  elsif r = 'driver' then
    select on_duty into duty from cc_members where user_id = auth.uid();
    return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object('id', o.id, 'ref', o.ref, 'kind', o.kind, 'status', o.status, 'urgency', o.urgency,
        'title', case when o.blind then null else o.title end,
        'need_by', o.need_by, 'created_at', o.created_at, 'driver_id', o.driver_id, 'mine', o.driver_id = auth.uid(),
        'stops', (select count(*) from cc_stops s where s.order_id = o.id),
        'stops_done', (select count(*) from cc_stops s where s.order_id = o.id and s.status = 'done')) x
      from cc_orders o
      where (o.driver_id = auth.uid() and (o.status in ('assigned', 'in_progress') or o.updated_at > now() - interval '3 days'))
         or (o.status = 'dispatching' and duty)
      order by o.created_at desc limit 100) t), '[]'::jsonb);
  else
    return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object('id', o.id, 'ref', o.ref, 'kind', o.kind, 'status', o.status, 'urgency', o.urgency, 'title', o.title,
        'need_by', o.need_by, 'created_at', o.created_at,
        'total_cents', (select total_cents from cc_quotes q where q.order_id = o.id and q.status in ('sent', 'accepted') order by q.id desc limit 1),
        'stops', (select count(*) from cc_stops s where s.order_id = o.id),
        'stops_done', (select count(*) from cc_stops s where s.order_id = o.id and s.status = 'done')) x
      from cc_orders o where o.org_id = org order by o.created_at desc limit 200) t), '[]'::jsonb);
  end if;
end $$;

create or replace function public.cc_get_order(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r text := cc_require('owner', 'dispatcher', 'driver', 'client', 'store');
  o cc_orders; side text; res jsonb; is_driver boolean; show_cargo boolean;
begin
  select * into o from cc_orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;
  if r in ('owner', 'dispatcher') then side := 'dispatch';
  elsif r = 'driver' then
    side := 'driver';
    if not (o.driver_id is not distinct from auth.uid() or (o.status = 'dispatching' and (select on_duty from cc_members where user_id = auth.uid()))) then
      raise exception 'Order not found.';
    end if;
  else
    side := 'client';
    if o.org_id is distinct from cc_my_org() then raise exception 'Order not found.'; end if;
  end if;
  is_driver := side = 'driver';
  show_cargo := not is_driver or not o.blind;

  res := jsonb_build_object(
    'id', o.id, 'ref', o.ref, 'kind', o.kind, 'status', o.status, 'urgency', o.urgency, 'blind', o.blind,
    'title', case when show_cargo then o.title end, 'notes', case when show_cargo then o.notes end,
    'need_by', o.need_by, 'created_at', o.created_at, 'updated_at', o.updated_at, 'invoice_ref', case when side <> 'driver' then o.invoice_ref end,
    'side', side,
    'stops', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'seq', s.seq, 'kind', s.kind, 'place_name', s.place_name, 'address', s.address, 'supplier_slug', s.supplier_slug,
        'contact', case when side = 'client' or o.driver_id = auth.uid() or side = 'dispatch' then s.contact end,
        'instructions', s.instructions, 'lat', s.lat, 'lng', s.lng, 'status', s.status, 'arrived_at', s.arrived_at, 'done_at', s.done_at,
        'received_by', s.received_by, 'note', s.note) order by s.seq) from cc_stops s where s.order_id = o.id), '[]'::jsonb),
    'items', case when show_cargo then coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'action', i.action, 'supplier_name', i.supplier_name, 'supplier_slug', i.supplier_slug, 'description', i.description,
        'part_no', i.part_no, 'qty', i.qty, 'store_status', i.store_status,
        'store_name', case when side = 'dispatch' then (select name from cc_orgs g where g.id = i.store_org_id) end,
        'store_price_cents', case when side = 'dispatch' then i.store_price_cents end,
        'store_note', case when side = 'dispatch' then i.store_note end) order by i.seq) from cc_items i where i.order_id = o.id), '[]'::jsonb)
      else '[]'::jsonb end,
    'cargo_hidden', not show_cargo,
    'item_count', (select count(*) from cc_items i where i.order_id = o.id),
    'driver_name', case when side <> 'driver' then (select display_name from profiles p where p.id = o.driver_id) end,
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'type', e.type, 'detail',
        case when side = 'dispatch' then e.detail else e.detail - 'driver' end) order by e.id)
      from cc_events e where e.order_id = o.id and (side = 'dispatch' or (side = 'client' and e.client_visible)
        or (side = 'driver' and o.driver_id = auth.uid()))), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'internal', m.internal, 'sender_side', m.sender_side,
        'mine', m.sender = auth.uid(), 'at', m.created_at,
        'sender_name', case when m.sender_side = 'internal' and side = 'client' then 'Dispatch' else (select display_name from profiles p where p.id = m.sender) end) order by m.id)
      from cc_order_messages m where m.order_id = o.id and (side = 'dispatch' or (side = 'client' and not m.internal)
        or (side = 'driver' and m.internal and o.driver_id = auth.uid()))), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'path', a.path, 'name', a.name, 'stop_id', a.stop_id) order by a.id)
      from cc_attachments a where a.order_id = o.id and (side <> 'driver' or a.kind = 'proof' or not o.blind)), '[]'::jsonb)
  );
  if side <> 'driver' then
    res := res || jsonb_build_object('quote', (select jsonb_build_object('id', q.id, 'parts_cents', q.parts_cents, 'purchase_fee_cents', q.purchase_fee_cents,
        'courier_cents', q.courier_cents, 'rush_cents', q.rush_cents, 'total_cents', q.total_cents, 'note', q.note, 'valid_until', q.valid_until, 'status', q.status)
      from cc_quotes q where q.order_id = o.id and q.status <> 'superseded' order by q.id desc limit 1));
  end if;
  if side = 'dispatch' then
    res := res || jsonb_build_object('org_name', (select name from cc_orgs g where g.id = o.org_id), 'driver_id', o.driver_id);
  end if;
  return res;
end $$;

create or replace function public.cc_post_message(p_order uuid, p_body text, p_internal boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r text := cc_require('owner', 'dispatcher', 'driver', 'client', 'store'); o cc_orders; b text := btrim(coalesce(p_body, '')); internal boolean := coalesce(p_internal, false);
begin
  select * into o from cc_orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;
  if char_length(b) not between 1 and 2000 then raise exception 'Write a message of up to 2000 characters.'; end if;
  if r = 'driver' then
    if o.driver_id is distinct from auth.uid() then raise exception 'Order not found.'; end if;
    internal := true;
  elsif r in ('client', 'store') then
    if o.org_id is distinct from cc_my_org() then raise exception 'Order not found.'; end if;
    internal := false;
  end if;
  insert into cc_order_messages (order_id, sender, sender_side, internal, body)
  values (p_order, auth.uid(), case when r in ('client', 'store') then 'client' else 'internal' end, internal, b);
  if r in ('client', 'store') or r = 'driver' then
    perform cc_notify_dispatch(p_order, 'New job message', 'New message on ' || o.ref || '.');
  elsif internal then
    if o.driver_id is not null and o.driver_id <> auth.uid() then perform cc_notify(o.driver_id, p_order, 'New job message', 'New message on ' || o.ref || '.'); end if;
  else
    perform cc_notify_org(o.org_id, p_order, 'New message', 'Dispatch sent a message on ' || o.ref || '.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_add_attachment(p_order uuid, p_path text, p_name text, p_kind text, p_stop uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r text := cc_require('owner', 'dispatcher', 'driver', 'client', 'store'); o cc_orders;
begin
  select * into o from cc_orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;
  if p_kind not in ('proof', 'drawing', 'po') then raise exception 'Unknown file type.'; end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> p_order::text then raise exception 'That file path is not valid.'; end if;
  if r = 'driver' and (o.driver_id is distinct from auth.uid() or p_kind <> 'proof') then raise exception 'That job is not yours.'; end if;
  if r in ('client', 'store') and (o.org_id is distinct from cc_my_org() or p_kind = 'proof') then raise exception 'Order not found.'; end if;
  insert into cc_attachments (order_id, stop_id, kind, path, name, uploaded_by)
  values (p_order, p_stop, p_kind, p_path, left(btrim(coalesce(p_name, 'file')), 160), auth.uid());
  perform cc_log(p_order, 'file_added', jsonb_build_object('kind', p_kind));
  return jsonb_build_object('ok', true);
end $$;

-- ── GPS ──────────────────────────────────────────────────────────────────
-- Phones send a position only while the driver is on duty, and only the latest one is kept.
create or replace function public.cc_ping(p_lat double precision, p_lng double precision, p_accuracy double precision default null,
                                          p_heading double precision default null, p_speed double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform cc_require('owner', 'dispatcher', 'driver');
  if not (select on_duty from cc_members where user_id = auth.uid()) then return jsonb_build_object('stored', false); end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Bad position.'; end if;
  insert into cc_driver_pos (user_id, lat, lng, accuracy_m, heading, speed_mps, at)
  values (auth.uid(), p_lat, p_lng, p_accuracy, p_heading, p_speed, now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
    heading = excluded.heading, speed_mps = excluded.speed_mps, at = now();
  return jsonb_build_object('stored', true);
end $$;

create or replace function public.cc_fleet() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform cc_require('owner', 'dispatcher');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.user_id, 'name', p.display_name, 'role', m.role, 'on_duty', m.on_duty, 'vehicle', m.vehicle, 'nda_ok', cc_nda_ok(m.user_id),
      'lat', pos.lat, 'lng', pos.lng, 'accuracy_m', pos.accuracy_m, 'at', pos.at,
      'jobs', (select coalesce(jsonb_agg(o.ref), '[]'::jsonb) from cc_orders o where o.driver_id = m.user_id and o.status in ('assigned', 'in_progress'))
    ) order by m.on_duty desc, p.display_name)
    from cc_members m join profiles p on p.id = m.user_id left join cc_driver_pos pos on pos.user_id = m.user_id
    where m.role in ('owner', 'dispatcher', 'driver') and m.active), '[]'::jsonb);
end $$;

-- A customer sees the driver only while the driver is running that customer's job alone,
-- so tracking can never reveal another customer's stop.
create or replace function public.cc_track(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text := cc_require('owner', 'dispatcher', 'client', 'store'); o cc_orders; pos cc_driver_pos; others int;
begin
  select * into o from cc_orders where id = p_order;
  if o.id is null or (r in ('client', 'store') and o.org_id is distinct from cc_my_org()) then raise exception 'Order not found.'; end if;
  if o.status <> 'in_progress' or o.driver_id is null then return jsonb_build_object('state', 'not_moving'); end if;
  select count(*) into others from cc_orders where driver_id = o.driver_id and status = 'in_progress' and id <> o.id;
  if others > 0 and r in ('client', 'store') then return jsonb_build_object('state', 'hidden'); end if;
  select * into pos from cc_driver_pos where user_id = o.driver_id and at > now() - interval '10 minutes';
  if pos.user_id is null then return jsonb_build_object('state', 'no_signal'); end if;
  return jsonb_build_object('state', 'live', 'lat', pos.lat, 'lng', pos.lng, 'accuracy_m', pos.accuracy_m, 'at', pos.at);
end $$;

-- ── Alerts ───────────────────────────────────────────────────────────────
create or replace function public.cc_alerts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  return coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', id, 'order_id', order_id, 'title', title, 'body', body,
      'urgent', urgent, 'read', read_at is not null, 'at', created_at) x
    from cc_notifications where user_id = auth.uid() order by id desc limit 40) t), '[]'::jsonb);
end $$;

create or replace function public.cc_alerts_read() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update cc_notifications set read_at = now() where user_id = auth.uid() and read_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- ── Admin ────────────────────────────────────────────────────────────────
create or replace function public.cc_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform cc_require('owner');
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.user_id, 'username', p.username, 'name', p.display_name, 'role', m.role, 'active', m.active,
        'org_id', m.org_id, 'org_name', g.name, 'on_duty', m.on_duty, 'nda_ok', cc_nda_ok(m.user_id)) order by p.display_name)
      from cc_members m join profiles p on p.id = m.user_id left join cc_orgs g on g.id = m.org_id), '[]'::jsonb),
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'supplier_slug', supplier_slug, 'contact_name', contact_name,
        'phone', phone, 'email', email, 'address', address, 'active', active) order by name) from cc_orgs), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'company', company, 'contact', contact, 'email', email, 'phone', phone,
        'kind', kind, 'note', note, 'at', created_at) order by id desc) from cc_access_requests where status = 'new'), '[]'::jsonb)
  );
end $$;

create or replace function public.cc_admin_set_member(p_user uuid, p_role text, p_org uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur cc_members;
begin
  perform cc_require('owner');
  select * into cur from cc_members where user_id = p_user;
  if cur.user_id is null then raise exception 'That login was not found.'; end if;
  if p_role not in ('pending', 'owner', 'dispatcher', 'driver', 'client', 'store') then raise exception 'Unknown role.'; end if;
  if p_role in ('client', 'store') and p_org is null then raise exception 'Customers and stores need a company.'; end if;
  if cur.role = 'owner' and (p_role <> 'owner' or not p_active)
     and (select count(*) from cc_members where role = 'owner' and active and user_id <> p_user) = 0 then
    raise exception 'Keep at least one owner.';
  end if;
  update cc_members set role = p_role, org_id = case when p_role in ('client', 'store') then p_org end, active = p_active,
    on_duty = case when p_role in ('owner', 'dispatcher', 'driver') and p_active then on_duty else false end where user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_admin_save_org(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare oid uuid := nullif(p->>'id', '')::uuid; nm text := btrim(coalesce(p->>'name', ''));
begin
  perform cc_require('owner');
  if char_length(nm) not between 1 and 120 then raise exception 'Give the company a name.'; end if;
  if coalesce(p->>'kind', 'client') not in ('client', 'store') then raise exception 'Pick customer or store.'; end if;
  if oid is null then
    insert into cc_orgs (name, kind, supplier_slug, contact_name, phone, email, address)
    values (nm, coalesce(p->>'kind', 'client'), nullif(p->>'supplier_slug', ''), p->>'contact_name', p->>'phone', p->>'email', p->>'address')
    returning id into oid;
  else
    update cc_orgs set name = nm, kind = coalesce(p->>'kind', kind), supplier_slug = nullif(p->>'supplier_slug', ''), contact_name = p->>'contact_name',
      phone = p->>'phone', email = p->>'email', address = p->>'address', active = coalesce((p->>'active')::boolean, active) where id = oid;
  end if;
  return jsonb_build_object('id', oid);
end $$;

create or replace function public.cc_admin_resolve_request(p_id bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform cc_require('owner');
  if p_status not in ('approved', 'declined') then raise exception 'Unknown status.'; end if;
  update cc_access_requests set status = p_status where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ── Files (drawings, POs, delivery photos) ───────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cc-files', 'cc-files', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public.cc_can_upload(p_order text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare o cc_orders; r text := cc_role();
begin
  if not cc_nda_ok() then return false; end if;
  begin select * into o from cc_orders where id = p_order::uuid; exception when others then return false; end;
  if o.id is null then return false; end if;
  return r in ('owner', 'dispatcher') or (r = 'driver' and o.driver_id = auth.uid())
    or (r in ('client', 'store') and o.org_id = cc_my_org());
end $$;

create or replace function public.cc_can_read_file(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare a cc_attachments; o cc_orders; r text := cc_role();
begin
  if not cc_nda_ok() then return false; end if;
  select * into a from cc_attachments where path = p_path;
  if a.id is null then return false; end if;
  select * into o from cc_orders where id = a.order_id;
  return r in ('owner', 'dispatcher') or (r = 'driver' and o.driver_id = auth.uid() and (a.kind = 'proof' or not o.blind))
    or (r in ('client', 'store') and o.org_id = cc_my_org());
end $$;

drop policy if exists "cc upload" on storage.objects;
create policy "cc upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'cc-files' and public.cc_can_upload((storage.foldername(name))[1]));
drop policy if exists "cc read" on storage.objects;
create policy "cc read" on storage.objects for select to authenticated
  using (bucket_id = 'cc-files' and (public.cc_can_read_file(name) or (owner = auth.uid() and public.cc_can_upload((storage.foldername(name))[1]))));

-- ── Live feed and push alerts ────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.cc_notifications;
exception when duplicate_object then null; end $$;

create or replace function public.cc_push_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://xppyedslhbrnqnymaaxb.supabase.co/functions/v1/push',
    body := jsonb_build_object('type', 'job', 'id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', coalesce(current_setting('request.headers', true)::jsonb ->> 'authorization', '')
    )
  );
  return new;
exception when others then
  return new; -- an alert problem must never block an order
end $$;
revoke execute on function public.cc_push_notify() from public, anon, authenticated;
drop trigger if exists cc_notifications_push on public.cc_notifications;
create trigger cc_notifications_push after insert on public.cc_notifications
  for each row execute function public.cc_push_notify();

-- ── Who can call what ────────────────────────────────────────────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'cc\_%' and p.prokind = 'f' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

grant execute on function
  public.cc_role(uuid), public.cc_is_internal(uuid), public.cc_me(), public.cc_current_nda(),
  public.cc_accept_nda(text, text, text, text, text), public.cc_list_stores(), public.cc_submit_order(jsonb),
  public.cc_send_quote(uuid, int, int, int, int, text, int), public.cc_respond_quote(uuid, boolean, text),
  public.cc_set_duty(boolean, text), public.cc_dispatch(uuid, uuid), public.cc_claim_job(uuid), public.cc_release_job(uuid, text),
  public.cc_stop_update(uuid, text, text, text, double precision, double precision), public.cc_close_order(uuid, text),
  public.cc_cancel_order(uuid, text), public.cc_store_requests(), public.cc_store_respond(uuid, boolean, int, text),
  public.cc_list_orders(), public.cc_get_order(uuid), public.cc_post_message(uuid, text, boolean),
  public.cc_add_attachment(uuid, text, text, text, uuid), public.cc_ping(double precision, double precision, double precision, double precision, double precision),
  public.cc_fleet(), public.cc_track(uuid), public.cc_alerts(), public.cc_alerts_read(), public.cc_admin_overview(),
  public.cc_admin_set_member(uuid, text, uuid, boolean), public.cc_admin_save_org(jsonb), public.cc_admin_resolve_request(bigint, text),
  public.cc_nda_ok(uuid), public.cc_can_upload(text), public.cc_can_read_file(text)
to authenticated;
grant execute on function public.cc_request_access(text, text, text, text, text, text) to anon, authenticated;

-- The profile and message policies call these as the signed-in person.
grant execute on function public.cc_is_internal(uuid), public.cc_role(uuid), public.cc_is_dispatch(uuid), public.cc_my_org() to authenticated;
