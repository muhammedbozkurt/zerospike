-- Spike cost hardening (K22): the ceilings the ai-ask-spike function checks before
-- it pays for a model call, enforced atomically in Postgres.
--
-- Until now the daily cap was read, then the model was called, then the count was
-- written, so requests that arrived together all passed a check nobody had spent
-- yet; the per-address limit lived in one isolate's memory; and nothing bounded the
-- total. A caller who rotates random device ids (the id is chosen by the client)
-- and forged X-Forwarded-For values could run the model bill up without limit.
--
-- spike_reserve() takes the slots in ONE call, before the model is invoked:
--   1. the caller address: one request counted in spike_ip_usage for the hour;
--   2. the device: one message in spike_usage for the UTC day, only while under its cap;
--   3. the whole service: one call in spike_global_usage for the UTC day, only while
--      under the global cap.
-- A refusal takes nothing from the later steps (a device slot taken before a refused
-- global step is handed back inside the same transaction). spike_release() gives the
-- device and global slots back when the model failed and the user got no reply.
--
-- Privacy: an address is never stored. The function sends a keyed hash of it (the
-- /64 prefix for IPv6), kept only for the hour it counts in and deleted after two
-- days. spike_usage and spike_calls keep their 90 days (purge_spike_logs).
--
-- Idempotent: tables and indexes use if not exists, functions use create or replace,
-- grants and RLS settings are repeatable. increment_spike_usage() from the first
-- migration stays for the function version still deployed until the new one is live.

create table if not exists public.spike_global_usage (
  day text primary key,                  -- UTC day key, same format as spike_usage.day
  count integer not null default 0       -- model calls reserved that day, all callers
);

create table if not exists public.spike_ip_usage (
  ip_hash text not null,                 -- keyed hash of the caller address, never the address
  hour_start timestamptz not null,       -- UTC hour the requests are counted in
  count integer not null default 0,
  primary key (ip_hash, hour_start)
);

create index if not exists spike_ip_usage_hour_idx on public.spike_ip_usage (hour_start);

-- RLS on with NO policies, and Supabase's default anon/authenticated grants removed:
-- only the service role (the edge function, through the functions below) touches these.
alter table public.spike_global_usage enable row level security;
alter table public.spike_ip_usage enable row level security;
revoke all on table public.spike_global_usage from anon, authenticated;
revoke all on table public.spike_ip_usage from anon, authenticated;
revoke all on table public.spike_usage from anon, authenticated;
grant select, insert, update, delete on table public.spike_global_usage to service_role;
grant select, insert, update, delete on table public.spike_ip_usage to service_role;

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
    return 'global';
  end if;
  if p_count_device and p_device_cap < 1 then
    return 'device';
  end if;

  -- 1. The caller address. Counted even when it ends up refused, so a flood keeps
  -- counting against itself.
  insert into public.spike_ip_usage as u (ip_hash, hour_start, count)
  values (p_ip_hash, v_hour, 1)
  on conflict (ip_hash, hour_start) do update set count = u.count + 1
  returning u.count into v_count;
  if v_count > p_ip_cap then
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
    return 'global';
  end if;

  return 'ok';
end;
$$;

create or replace function public.spike_release(
  p_device_id text,
  p_day text,
  p_count_device boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_count_device then
    update public.spike_usage
       set count = count - 1
     where device_id = p_device_id and day = p_day and count > 0;
  end if;
  update public.spike_global_usage
     set count = count - 1
   where day = p_day and count > 0;
end;
$$;

revoke execute on function public.spike_reserve(text, text, text, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.spike_reserve(text, text, text, integer, integer, integer, boolean) to service_role;
revoke execute on function public.spike_release(text, text, boolean) from public, anon, authenticated;
grant execute on function public.spike_release(text, text, boolean) to service_role;

-- Retention: the new counters are deleted with the rest. Address counts only matter
-- for the hour they were made in, so two days is already generous.
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
$$;

revoke execute on function public.purge_spike_logs(integer) from public, anon, authenticated;
grant execute on function public.purge_spike_logs(integer) to service_role;
