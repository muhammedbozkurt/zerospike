-- Spike refusal counters: how often the 429 ceilings fire, per reason, with no
-- identifier stored. A row is (UTC hour, reason, the cap that was in force) and a
-- count; no address hash and no device id ever reaches this table.
--
-- spike_reserve() is unchanged except that each of its five refusals first counts
-- itself here. v_spike_gate_daily puts the refusals next to the model calls that went
-- through (spike_global_usage), per UTC day.
--
-- Idempotent: if not exists, create or replace, repeatable grants.

create table if not exists public.spike_reject_usage (
  hour_start timestamptz not null,
  reason text not null check (reason in ('ip', 'device', 'global')),
  cap integer not null,
  count integer not null default 0,
  primary key (hour_start, reason, cap)
);

alter table public.spike_reject_usage enable row level security;
revoke all on table public.spike_reject_usage from anon, authenticated;
grant select, insert, update, delete on table public.spike_reject_usage to service_role;

create or replace function public.spike_reserve(
  p_device_id text,
  p_day text,
  p_ip_hash text,
  p_device_cap integer,
  p_ip_cap integer,
  p_global_cap integer,
  p_count_device boolean default true
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hour timestamptz := date_trunc('hour', now(), 'UTC');
  v_count integer;
begin
  if p_global_cap < 1 then
    insert into public.spike_reject_usage as r (hour_start, reason, cap, count)
    values (v_hour, 'global', p_global_cap, 1)
    on conflict (hour_start, reason, cap) do update set count = r.count + 1;
    return 'global';
  end if;
  if p_count_device and p_device_cap < 1 then
    insert into public.spike_reject_usage as r (hour_start, reason, cap, count)
    values (v_hour, 'device', p_device_cap, 1)
    on conflict (hour_start, reason, cap) do update set count = r.count + 1;
    return 'device';
  end if;

  -- 1. The caller address. Counted even when it ends up refused, so a flood keeps
  -- counting against itself.
  insert into public.spike_ip_usage as u (ip_hash, hour_start, count)
  values (p_ip_hash, v_hour, 1)
  on conflict (ip_hash, hour_start) do update set count = u.count + 1
  returning u.count into v_count;
  if v_count > p_ip_cap then
    insert into public.spike_reject_usage as r (hour_start, reason, cap, count)
    values (v_hour, 'ip', p_ip_cap, 1)
    on conflict (hour_start, reason, cap) do update set count = r.count + 1;
    return 'ip';
  end if;

  -- 2. The device's message for the day, taken only while the device is under its
  -- cap: concurrent requests queue on the row lock and each sees the updated count.
  -- A free retry of a message already paid for passes p_count_device = false.
  if p_count_device then
    v_count := null;
    insert into public.spike_usage as s (device_id, day, count)
    values (p_device_id, p_day, 1)
    on conflict (device_id, day) do update set count = s.count + 1
      where s.count < p_device_cap
    returning s.count into v_count;
    if v_count is null then
      insert into public.spike_reject_usage as r (hour_start, reason, cap, count)
      values (v_hour, 'device', p_device_cap, 1)
      on conflict (hour_start, reason, cap) do update set count = r.count + 1;
      return 'device';
    end if;
  end if;

  -- 3. The service-wide call for the day, the same way.
  v_count := null;
  insert into public.spike_global_usage as g (day, count)
  values (p_day, 1)
  on conflict (day) do update set count = g.count + 1
    where g.count < p_global_cap
  returning g.count into v_count;
  if v_count is null then
    if p_count_device then
      update public.spike_usage
         set count = count - 1
       where device_id = p_device_id and day = p_day and count > 0;
    end if;
    insert into public.spike_reject_usage as r (hour_start, reason, cap, count)
    values (v_hour, 'global', p_global_cap, 1)
    on conflict (hour_start, reason, cap) do update set count = r.count + 1;
    return 'global';
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.spike_reserve(text, text, text, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.spike_reserve(text, text, text, integer, integer, integer, boolean) to service_role;

create or replace function public.purge_spike_logs(p_keep_days integer default 90)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.spike_calls
   where created_at < now() - make_interval(days => p_keep_days);
  delete from public.spike_usage
   where day < to_char((now() at time zone 'utc')::date - p_keep_days, 'YYYY-MM-DD');
  delete from public.spike_global_usage
   where day < to_char((now() at time zone 'utc')::date - p_keep_days, 'YYYY-MM-DD');
  delete from public.spike_ip_usage
   where hour_start < now() - interval '2 days';
  delete from public.spike_reject_usage
   where hour_start < now() - make_interval(days => p_keep_days);
$$;

revoke execute on function public.purge_spike_logs(integer) from public, anon, authenticated;
grant execute on function public.purge_spike_logs(integer) to service_role;

create or replace view public.v_spike_gate_daily
with (security_invoker = true) as
select
  to_date(g.day, 'YYYY-MM-DD') as day,
  'ok'::text as reason,
  null::integer as cap,
  g.count::bigint as n
from public.spike_global_usage g
union all
select
  (r.hour_start at time zone 'UTC')::date as day,
  r.reason,
  r.cap,
  sum(r.count)::bigint as n
from public.spike_reject_usage r
group by 1, 2, 3;

revoke all on public.v_spike_gate_daily from anon, authenticated;
