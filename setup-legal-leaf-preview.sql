-- Isolated Supabase staging only. Run after setup-courier.sql.
-- Populate the intake allowlist and staff roster as the database owner with fictional records.
begin;

create schema if not exists cc_legal_leaf;
revoke all on schema cc_legal_leaf from public, anon, authenticated;

create table if not exists cc_legal_leaf.pilot (
  singleton boolean primary key default true check (singleton),
  org_id uuid not null unique references public.cc_orgs(id)
);

create table if not exists cc_legal_leaf.staff (
  user_id uuid primary key references public.cc_members(user_id),
  staff_role text not null check (staff_role in ('dispatch','driver'))
);

create table if not exists cc_legal_leaf.intake (
  order_number text primary key,
  pickup_address text not null,
  drop_address text not null,
  recipient text not null,
  contact text not null,
  instructions text not null default '',
  check (order_number ~ '^LL-SAMPLE-[0-9]{3}$')
);

create table if not exists cc_legal_leaf.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references cc_legal_leaf.pilot(org_id),
  order_number text unique not null references cc_legal_leaf.intake(order_number),
  driver_id uuid not null references cc_legal_leaf.staff(user_id),
  window_start timestamptz not null,
  window_end timestamptz not null check (window_end > window_start),
  attempt integer not null default 1,
  status text not null default 'assigned' check (status in ('assigned','picked_up','handed_off','failed','cancelled')),
  updated_at timestamptz not null default now()
);

create table if not exists cc_legal_leaf.events (
  id bigint generated always as identity primary key,
  job_id uuid not null references cc_legal_leaf.jobs(id),
  attempt integer not null,
  actor uuid not null references cc_legal_leaf.staff(user_id),
  outcome text not null,
  reason text,
  at timestamptz not null default now()
);

create or replace function cc_legal_leaf.role_for(p_user uuid) returns text
language sql stable set search_path = '' as $$
  select s.staff_role
  from cc_legal_leaf.staff s
  join public.cc_members m on m.user_id = s.user_id and m.active
  join cc_legal_leaf.pilot p on p.org_id = m.org_id
  join public.cc_orgs o on o.id = p.org_id and o.active
  where s.user_id = p_user and public.cc_nda_ok(p_user)
    and ((s.staff_role = 'dispatch' and m.role in ('owner','dispatcher'))
      or (s.staff_role = 'driver' and m.role = 'driver'))
$$;

create or replace function public.cc_ll_preview_assign(
  p_order text, p_driver uuid, p_start timestamptz, p_end timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if cc_legal_leaf.role_for(auth.uid()) is distinct from 'dispatch' then
    raise exception 'Legal Leaf dispatch access required.' using errcode = '42501';
  end if;
  -- Lock the retail reference first. Retries return the same identifier even
  -- after a handoff, and deliberate changes use the separate update RPC.
  perform 1 from cc_legal_leaf.intake where order_number = p_order for update;
  if not found then raise exception 'Confirmed sample order required.'; end if;
  select id into v_id from cc_legal_leaf.jobs where order_number = p_order;
  if found then return v_id; end if;
  if cc_legal_leaf.role_for(p_driver) is distinct from 'driver' then
    raise exception 'Pick an active Legal Leaf driver.';
  end if;
  insert into cc_legal_leaf.jobs(org_id, order_number, driver_id, window_start, window_end)
    select org_id, p_order, p_driver, p_start, p_end from cc_legal_leaf.pilot
    returning id into v_id;
  insert into cc_legal_leaf.events(job_id, attempt, actor, outcome)
    values (v_id, 1, auth.uid(), 'assigned');
  perform public.cc_notify(p_driver, null, 'Staff delivery assigned', 'Open Legal Leaf staff deliveries for details.');
  return v_id;
end $$;

create or replace function public.cc_ll_preview_jobs(p_job uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := cc_legal_leaf.role_for(auth.uid());
begin
  if v_role is null then
    raise exception 'Legal Leaf staff access required.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(j) || to_jsonb(i) || jsonb_build_object(
      'events', coalesce((select jsonb_agg(jsonb_build_object(
        'attempt', e.attempt, 'outcome', e.outcome, 'reason', e.reason, 'at', e.at
      ) order by e.id) from cc_legal_leaf.events e where e.job_id = j.id), '[]'::jsonb)
    ) order by j.updated_at desc)
    from cc_legal_leaf.jobs j join cc_legal_leaf.intake i using (order_number)
    where (p_job is null or j.id = p_job)
      and (v_role = 'dispatch' or j.driver_id = auth.uid())
  ), '[]'::jsonb);
end $$;

create or replace function public.cc_ll_preview_update(
  p_job uuid, p_attempt integer, p_action text, p_reason text default null,
  p_driver uuid default null, p_start timestamptz default null, p_end timestamptz default null,
  p_doorstep_checks_ok boolean default false
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := cc_legal_leaf.role_for(auth.uid());
  j cc_legal_leaf.jobs;
  v_status text;
begin
  if v_role is null then
    raise exception 'Legal Leaf staff access required.' using errcode = '42501';
  end if;
  select * into j from cc_legal_leaf.jobs
    where id = p_job and (v_role = 'dispatch' or driver_id = auth.uid()) for update;
  if not found then raise exception 'Delivery job unavailable.' using errcode = '42501'; end if;
  if p_attempt is distinct from j.attempt then raise exception 'Delivery attempt changed. Refresh the job.'; end if;

  if v_role = 'driver' then
    if p_action = 'picked_up' and j.status = 'assigned' then v_status := 'picked_up';
    elsif p_action = 'handed_off' and j.status = 'picked_up' and p_doorstep_checks_ok is true then v_status := 'handed_off';
    elsif p_action = 'failed' and j.status = 'picked_up'
      and p_reason in ('recipient_unavailable','id_check_failed','cash_short_or_missing') then
      v_status := 'failed';
    else raise exception 'That stop outcome is unavailable.';
    end if;
  elsif p_action = 'rescheduled' and j.status in ('assigned','failed') then
    if cc_legal_leaf.role_for(p_driver) is distinct from 'driver' then raise exception 'Pick an active Legal Leaf driver.'; end if;
    j.attempt := j.attempt + 1;
    j.driver_id := p_driver;
    j.window_start := p_start;
    j.window_end := p_end;
    v_status := 'assigned';
    perform public.cc_notify(p_driver, null, 'Staff delivery assigned', 'Open Legal Leaf staff deliveries for details.');
  elsif p_action = 'cancelled' and j.status in ('assigned','failed') then
    v_status := 'cancelled';
  else
    raise exception 'That dispatch action is unavailable.';
  end if;

  update cc_legal_leaf.jobs set status = v_status, driver_id = j.driver_id, attempt = j.attempt,
    window_start = j.window_start, window_end = j.window_end, updated_at = now() where id = j.id;
  insert into cc_legal_leaf.events(job_id, attempt, actor, outcome, reason)
    values (j.id, j.attempt, auth.uid(), p_action, case when v_status = 'failed' then p_reason end);
  return v_status;
end $$;

revoke execute on function public.cc_ll_preview_assign(text,uuid,timestamptz,timestamptz),
  public.cc_ll_preview_jobs(uuid),
  public.cc_ll_preview_update(uuid,integer,text,text,uuid,timestamptz,timestamptz,boolean)
  from public, anon, authenticated;
grant execute on function public.cc_ll_preview_assign(text,uuid,timestamptz,timestamptz),
  public.cc_ll_preview_jobs(uuid),
  public.cc_ll_preview_update(uuid,integer,text,text,uuid,timestamptz,timestamptz,boolean)
  to authenticated;

commit;
