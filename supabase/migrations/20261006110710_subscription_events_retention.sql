-- Retention, per-device deletion and Data API hardening for the server-side
-- stores (app_events, track_*, spike_*, subscription_events).
--
-- 1. subscription_events: the raw RevenueCat webhook body is kept 90 days, the
--    typed columns 24 months, then the row goes (purge_subscription_events,
--    same mold as purge_app_events in 20261006094929_app_events.sql).
-- 2. delete_device_data: the "delete my usage data" path. The delete-device
--    edge function calls it with the app's per-install device id.
-- 3. Grants: spike_usage still carried Supabase's default anon/authenticated
--    grants, and the default privileges in public hand them every new table.

-- subscription_events retention: raw 90 days, rows 24 months

-- raw was created NOT NULL; clearing it after 90 days needs it nullable.
-- Dropping NOT NULL on an already nullable column is a no-op, so re-runs are safe.
alter table public.subscription_events alter column raw drop not null;

comment on column public.subscription_events.raw is
  'Webhook body. Reserved $ subscriber attributes that can hold personal identifiers are removed before insert. Set to null once the row is 90 days old (purge_subscription_events), so the USD amount raw->''event''->>''price'' only exists for those 90 days.';

create or replace function public.purge_subscription_events(
  p_keep_months integer default 24,
  p_raw_keep_days integer default 90
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from public.subscription_events
  where received_at < now() - make_interval(months => p_keep_months);
  get diagnostics v_deleted = row_count;

  -- Past the raw window the typed columns stay and only the payload goes.
  -- Rows already cleared are skipped, so a re-run touches nothing.
  update public.subscription_events
  set raw = null
  where raw is not null
    and received_at < now() - make_interval(days => p_raw_keep_days);

  return v_deleted;
end;
$$;

revoke all on function public.purge_subscription_events(integer, integer) from public, anon, authenticated;
grant execute on function public.purge_subscription_events(integer, integer) to service_role;

-- Daily at 03:27 UTC, ten minutes after purge-app-events. This migration does
-- not enable pg_cron. If it is already enabled the job is (re)scheduled here;
-- otherwise enable pg_cron (Dashboard > Database > Extensions) and run once:
--   select cron.schedule('purge-subscription-events', '27 3 * * *', 'select public.purge_subscription_events(24, 90)');
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-subscription-events', '27 3 * * *', 'select public.purge_subscription_events(24, 90)');
  else
    raise notice 'pg_cron is not enabled: purge_subscription_events() is not scheduled, see the migration comment';
  end if;
end
$do$;

-- Device data deletion

-- Every row one device left in the server-side stores, removed in one
-- transaction; returns the rows removed per table. A new table that stores
-- device_id has to be added here. subscription_events is matched on its
-- device_id column only: events RevenueCat reported before the app set that
-- attribute carry no device_id and stay.
create or replace function public.delete_device_data(p_device_id text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  with
    ev as (delete from public.app_events where device_id = p_device_id returning 1),
    bt as (delete from public.track_batches where device_id = p_device_id returning 1),
    tu as (delete from public.track_usage where device_id = p_device_id returning 1),
    su as (delete from public.spike_usage where device_id = p_device_id returning 1),
    sc as (delete from public.spike_calls where device_id = p_device_id returning 1),
    se as (delete from public.subscription_events where device_id = p_device_id returning 1)
  select jsonb_build_object(
    'app_events', (select count(*) from ev),
    'track_batches', (select count(*) from bt),
    'track_usage', (select count(*) from tu),
    'spike_usage', (select count(*) from su),
    'spike_calls', (select count(*) from sc),
    'subscription_events', (select count(*) from se)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.delete_device_data(text) from public, anon, authenticated;
grant execute on function public.delete_device_data(text) to service_role;

-- spike_calls had no index on device_id: without one every delete is a scan.
create index if not exists spike_calls_device_id_idx on public.spike_calls (device_id);

-- Request counters for the delete-device function, one row per bucket per UTC
-- hour. Buckets are keyed hashes the function computes (device id and client
-- IP, both rotating daily), never the raw values, so nothing here points back
-- at a device that asked to be forgotten.
create table if not exists public.delete_usage (
  bucket text not null,
  hour_start timestamptz not null,
  requests integer not null default 0,
  primary key (bucket, hour_start)
);

create index if not exists delete_usage_hour_idx on public.delete_usage (hour_start);

alter table public.delete_usage enable row level security;
revoke all on table public.delete_usage from anon, authenticated;

-- Counts one delete request against the IP and the device and says whether it
-- may proceed. The IP goes first: a caller rotating device ids stops at the IP
-- cap before it can add device rows. Each counter is one atomic upsert, so
-- concurrent requests cannot slip past a cap. Counters older than 2 days are
-- dropped here, so the table stays small without a scheduled job.
create or replace function public.delete_request_allowed(
  p_device_bucket text,
  p_ip_bucket text,
  p_max_device integer,
  p_max_ip integer
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_hour timestamptz := date_trunc('hour', now(), 'UTC');
  v_requests integer;
begin
  delete from public.delete_usage
  where hour_start < now() - interval '2 days';

  insert into public.delete_usage as u (bucket, hour_start, requests)
  values ('i:' || p_ip_bucket, v_hour, 1)
  on conflict (bucket, hour_start) do update set requests = u.requests + 1
  returning u.requests into v_requests;
  if v_requests > p_max_ip then
    return false;
  end if;

  insert into public.delete_usage as u (bucket, hour_start, requests)
  values ('d:' || p_device_bucket, v_hour, 1)
  on conflict (bucket, hour_start) do update set requests = u.requests + 1
  returning u.requests into v_requests;

  return v_requests <= p_max_device;
end;
$$;

revoke all on function public.delete_request_allowed(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.delete_request_allowed(text, text, integer, integer) to service_role;

-- Data API exposure

-- spike_usage was the one table without the explicit revoke: RLS with no
-- policies was its only guard.
revoke all on table public.spike_usage from anon, authenticated;

-- Tables the migration role creates in public from now on are no longer handed
-- to anon/authenticated; reaching the Data API takes an explicit grant. Existing
-- tables keep their grants. Sequences and functions keep Supabase's defaults,
-- so those still need their own revoke.
alter default privileges in schema public revoke all on tables from anon, authenticated;
