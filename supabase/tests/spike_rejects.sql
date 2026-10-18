begin;

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

create temp table t_res (step text, ok boolean, detail text);

do $t$
declare
  v_hour timestamptz := date_trunc('hour', now(), 'UTC');
  v_before integer; v_after integer; v_r text; v_r2 text; v_sum1 integer; v_sum2 integer;
begin
  -- (a) ip ceiling
  select coalesce(sum(count), 0) into v_before from public.spike_reject_usage where hour_start = v_hour and reason = 'ip' and cap = 2;
  perform public.spike_reserve('k16a-dev-a1', '2099-01-01', 'k16a-ip-a', 100, 2, 1000000, true);
  perform public.spike_reserve('k16a-dev-a2', '2099-01-01', 'k16a-ip-a', 100, 2, 1000000, true);
  v_r := public.spike_reserve('k16a-dev-a3', '2099-01-01', 'k16a-ip-a', 100, 2, 1000000, true);
  select coalesce(sum(count), 0) into v_after from public.spike_reject_usage where hour_start = v_hour and reason = 'ip' and cap = 2;
  insert into t_res values ('a ip', v_r = 'ip' and v_after = v_before + 1, format('ret=%s before=%s after=%s', v_r, v_before, v_after));

  -- (b) free device ceiling, cap 3
  select coalesce(sum(count), 0) into v_before from public.spike_reject_usage where hour_start = v_hour and reason = 'device' and cap = 3;
  perform public.spike_reserve('k16a-dev-b', '2099-01-02', 'k16a-ip-b', 3, 1000, 1000000, true);
  perform public.spike_reserve('k16a-dev-b', '2099-01-02', 'k16a-ip-b', 3, 1000, 1000000, true);
  perform public.spike_reserve('k16a-dev-b', '2099-01-02', 'k16a-ip-b', 3, 1000, 1000000, true);
  v_r := public.spike_reserve('k16a-dev-b', '2099-01-02', 'k16a-ip-b', 3, 1000, 1000000, true);
  select coalesce(sum(count), 0) into v_after from public.spike_reject_usage where hour_start = v_hour and reason = 'device' and cap = 3;
  insert into t_res values ('b device', v_r = 'device' and v_after = v_before + 1, format('ret=%s before=%s after=%s', v_r, v_before, v_after));

  -- (c) global ceiling, cap 1
  select coalesce(sum(count), 0) into v_before from public.spike_reject_usage where hour_start = v_hour and reason = 'global' and cap = 1;
  v_r := public.spike_reserve('k16a-dev-c1', '2099-01-03', 'k16a-ip-c1', 100, 1000, 1, true);
  v_r2 := public.spike_reserve('k16a-dev-c2', '2099-01-03', 'k16a-ip-c2', 100, 1000, 1, true);
  select coalesce(sum(count), 0) into v_after from public.spike_reject_usage where hour_start = v_hour and reason = 'global' and cap = 1;
  insert into t_res values ('c global', v_r = 'ok' and v_r2 = 'global' and v_after = v_before + 1, format('ret1=%s ret2=%s before=%s after=%s', v_r, v_r2, v_before, v_after));

  -- (d) an accepted reserve leaves the reject counters alone
  select coalesce(sum(count), 0) into v_sum1 from public.spike_reject_usage;
  v_r := public.spike_reserve('k16a-dev-d', '2099-01-04', 'k16a-ip-d', 100, 1000, 1000000, true);
  select coalesce(sum(count), 0) into v_sum2 from public.spike_reject_usage;
  insert into t_res values ('d ok no change', v_r = 'ok' and v_sum1 = v_sum2, format('ret=%s sum_before=%s sum_after=%s', v_r, v_sum1, v_sum2));
end
$t$;

insert into t_res
select 'e no identifier columns',
       count(*) = 0 and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'spike_reject_usage') = 4,
       coalesce(string_agg(column_name, ','), 'none') || ' / cols=' || (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'spike_reject_usage')
from information_schema.columns
where table_schema = 'public' and table_name = 'spike_reject_usage'
  and column_name in ('ip_hash', 'device_id', 'ip', 'device');

insert into t_res
select 'g view has ok and reject rows', count(*) filter (where reason = 'ok') >= 1 and count(*) filter (where reason in ('ip','device','global')) >= 3,
       string_agg(reason || ':' || coalesce(cap::text, 'null') || ':' || n, ' ' order by reason, cap) filter (where day in ('2099-01-01','2099-01-02','2099-01-03', (now() at time zone 'utc')::date))
from public.v_spike_gate_daily;

set local role anon;
do $t$
begin
  begin
    perform count(*) from public.spike_reject_usage;
    create temp table if not exists t_anon (r text);
    insert into t_anon values ('READ ALLOWED');
  exception when insufficient_privilege then
    create temp table if not exists t_anon (r text);
    insert into t_anon values ('denied');
  end;
end
$t$;
reset role;
insert into t_res select 'f anon denied', r = 'denied', r from t_anon;

select step, ok, detail from t_res order by step;

rollback;
