-- First-party product analytics and subscription lifecycle.
--
-- app_events: anonymous app events, written ONLY by the `track` edge function.
-- Props are whitelisted per event by supabase/functions/_shared/event-schema.json
-- before they get here: no health values, no free text. device_id is the random
-- per-install uuid the app also sends to ai-ask-spike, never identity.
--
-- subscription_events: one row per RevenueCat webhook event, written ONLY by the
-- `rc-webhook` edge function, idempotent on the RevenueCat event id.
--
-- Access model: RLS on with NO policies (as spike_usage) plus explicit revokes,
-- because Supabase's default privileges hand anon/authenticated every new table,
-- view and function in public. Views run as the caller (security_invoker), so
-- the anon key embedded in the app can never read them through the Data API.

-- ── app_events ──────────────────────────────────────────────────────────────

create table if not exists public.app_events (
  id bigserial primary key,
  device_id text not null,
  session_id text,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  client_ts timestamptz,
  received_at timestamptz not null default now(),
  app_version text,
  build text,
  platform text,
  os_version text,
  locale text,
  is_pro boolean,
  tz_offset smallint
);

comment on column public.app_events.client_ts is
  'Event time on the device; null when the client sent none or it was more than 30 days old / 1 day ahead.';
comment on column public.app_events.tz_offset is
  'Device offset in minutes east of UTC (UTC+3 = 180), as sent by the client.';

create index if not exists app_events_name_received_idx on public.app_events (name, received_at);
create index if not exists app_events_device_received_idx on public.app_events (device_id, received_at);
-- Append-only time series: a BRIN index keeps the daily retention delete cheap.
create index if not exists app_events_received_brin on public.app_events using brin (received_at);

alter table public.app_events enable row level security;
revoke all on table public.app_events from anon, authenticated;
revoke all on sequence public.app_events_id_seq from anon, authenticated;

-- ── Ingest for `track`: rate limits, global ceiling, batch idempotency ──────
-- track_usage: one row per device per UTC hour, requests in that hour and
-- events stored in it. The daily event budget is the sum of the day's rows.

create table if not exists public.track_usage (
  device_id text not null,
  hour_start timestamptz not null,
  requests integer not null default 0,
  events integer not null default 0,
  primary key (device_id, hour_start)
);

alter table public.track_usage enable row level security;
revoke all on table public.track_usage from anon, authenticated;

-- track_ip_usage: requests per client IP per UTC hour. ip_hash is a keyed hash
-- the edge function computes and rotates daily; no IP is ever stored.
create table if not exists public.track_ip_usage (
  ip_hash text not null,
  hour_start timestamptz not null,
  requests integer not null default 0,
  primary key (ip_hash, hour_start)
);

alter table public.track_ip_usage enable row level security;
revoke all on table public.track_ip_usage from anon, authenticated;

-- track_global_usage: rows written to app_events per UTC day, all devices.
create table if not exists public.track_global_usage (
  day date primary key,
  events integer not null default 0
);

alter table public.track_global_usage enable row level security;
revoke all on table public.track_global_usage from anon, authenticated;

-- track_batches: batch ids already stored per device, so a client retrying a
-- batch whose 202 it never received does not write the events twice. Kept 30
-- days (purge_app_events).
create table if not exists public.track_batches (
  device_id text not null,
  batch_id uuid not null,
  received_at timestamptz not null default now(),
  primary key (device_id, batch_id)
);

create index if not exists track_batches_received_brin on public.track_batches using brin (received_at);

alter table public.track_batches enable row level security;
revoke all on table public.track_batches from anon, authenticated;

-- One call, one transaction. Returns the rows stored (0..n) or:
--   -1  hourly request cap hit, per IP hash or per device
--   -3  global daily ceiling would be exceeded
--   -2  this batch id was already stored for the device (nothing written)
-- Order matters. Everything that answers "retry later" (-1, -3) runs before the
-- batch claim: a claim committed together with a 429 would turn the client's
-- retry into a false duplicate. The claim and the insert commit together, so a
-- failed insert rolls the claim back too. Row locks (IP row, device row, today's
-- global row, then the claim's unique key) are always taken in this order and
-- held to commit: concurrent calls cannot double-spend a budget, push the global
-- total past its ceiling, or store one batch twice, and cannot deadlock.
create or replace function public.track_ingest(
  p_device_id text,
  p_ip_hash text,
  p_batch_id uuid,
  p_rows jsonb,
  p_max_ip_requests integer,
  p_max_requests integer,
  p_max_events integer,
  p_global_cap integer
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_hour timestamptz := date_trunc('hour', now(), 'UTC');
  v_day date := (now() at time zone 'UTC')::date;
  v_count integer;
  v_allowed integer;
begin
  insert into public.track_ip_usage as i (ip_hash, hour_start, requests)
  values (p_ip_hash, v_hour, 1)
  on conflict (ip_hash, hour_start) do update set requests = i.requests + 1
  returning i.requests into v_count;
  if v_count > p_max_ip_requests then
    return -1;
  end if;

  insert into public.track_usage as u (device_id, hour_start, requests)
  values (p_device_id, v_hour, 1)
  on conflict (device_id, hour_start) do update set requests = u.requests + 1
  returning u.requests into v_count;
  if v_count > p_max_requests then
    return -1;
  end if;

  select coalesce(sum(t.events), 0)::integer into v_count
  from public.track_usage t
  where t.device_id = p_device_id
    and t.hour_start >= date_trunc('day', now(), 'UTC');
  v_allowed := greatest(0, least(coalesce(jsonb_array_length(p_rows), 0), p_max_events - v_count));

  if v_allowed > 0 then
    -- The no-op update takes the lock on today's row and reads its total.
    insert into public.track_global_usage as g (day, events)
    values (v_day, 0)
    on conflict (day) do update set events = g.events
    returning g.events into v_count;
    if v_count + v_allowed > p_global_cap then
      return -3;
    end if;
  end if;

  if p_batch_id is not null then
    insert into public.track_batches (device_id, batch_id)
    values (p_device_id, p_batch_id)
    on conflict do nothing;
    if not found then
      return -2;
    end if;
  end if;

  if v_allowed = 0 then
    return 0;
  end if;

  update public.track_usage
  set events = events + v_allowed
  where device_id = p_device_id and hour_start = v_hour;

  update public.track_global_usage
  set events = events + v_allowed
  where day = v_day;

  -- Rows arrive already sanitized by the track function (event-schema.json).
  insert into public.app_events (
    device_id, session_id, name, props, client_ts,
    app_version, build, platform, os_version, locale, is_pro, tz_offset
  )
  select
    p_device_id, r.session_id, r.name, coalesce(r.props, '{}'::jsonb), r.client_ts,
    r.app_version, r.build, r.platform, r.os_version, r.locale, r.is_pro, r.tz_offset
  from jsonb_array_elements(p_rows) with ordinality as e(item, ord)
  cross join lateral jsonb_to_record(e.item) as r(
    session_id text, name text, props jsonb, client_ts timestamptz,
    app_version text, build text, platform text, os_version text,
    locale text, is_pro boolean, tz_offset smallint
  )
  where e.ord <= v_allowed;

  return v_allowed;
end;
$$;

revoke all on function public.track_ingest(text, text, uuid, jsonb, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.track_ingest(text, text, uuid, jsonb, integer, integer, integer, integer)
  to service_role;

-- ── Retention: app_events 180 days, track_batches 30 days ────────────────────

create or replace function public.purge_app_events(p_keep_days integer default 180)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from public.app_events
  where received_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_deleted = row_count;

  -- Rate-limit counters only matter for the current hour / UTC day.
  delete from public.track_usage
  where hour_start < now() - interval '2 days';

  delete from public.track_ip_usage
  where hour_start < now() - interval '2 days';

  delete from public.track_global_usage
  where day < (now() at time zone 'UTC')::date - 30;

  -- Idempotency only has to outlive client retries.
  delete from public.track_batches
  where received_at < now() - interval '30 days';

  return v_deleted;
end;
$$;

revoke all on function public.purge_app_events(integer) from public, anon, authenticated;

-- Daily at 03:17 UTC. This migration does not enable pg_cron. If it is already
-- enabled the job is (re)scheduled here; otherwise enable pg_cron (Dashboard >
-- Database > Extensions) and run once:
--   select cron.schedule('purge-app-events', '17 3 * * *', 'select public.purge_app_events(180)');
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-app-events', '17 3 * * *', 'select public.purge_app_events(180)');
  else
    raise notice 'pg_cron is not enabled: purge_app_events() is not scheduled, see the migration comment';
  end if;
end
$do$;

-- ── subscription_events (RevenueCat webhook) ────────────────────────────────

create table if not exists public.subscription_events (
  id bigserial primary key,
  rc_event_id text not null unique,
  type text,
  app_user_id text,
  original_app_user_id text,
  device_id text,
  product_id text,
  period_type text,
  store text,
  environment text,
  event_at timestamptz not null default now(),
  purchased_at timestamptz,
  expiration_at timestamptz,
  cancel_reason text,
  expiration_reason text,
  price numeric,
  currency text,
  country text,
  raw jsonb not null,
  received_at timestamptz not null default now()
);

comment on column public.subscription_events.device_id is
  'subscriber_attributes.device_id.value: the app''s per-install uuid, joins app_events.device_id.';
comment on column public.subscription_events.event_at is
  'RevenueCat event_timestamp_ms (when the event happened, e.g. the cancellation).';
comment on column public.subscription_events.price is
  'price_in_purchased_currency, in `currency`. The USD amount is raw->''event''->>''price''.';
comment on column public.subscription_events.raw is
  'Webhook body. Reserved $ subscriber attributes that can hold personal identifiers are removed before insert.';

alter table public.subscription_events enable row level security;
revoke all on table public.subscription_events from anon, authenticated;
revoke all on sequence public.subscription_events_id_seq from anon, authenticated;

-- ── Analysis views (production purchases only; sandbox/TestFlight excluded) ──

-- Unique devices per UTC day for each funnel step (day = client time when
-- known, otherwise arrival time).
create or replace view public.v_funnel_daily
with (security_invoker = true) as
select
  (coalesce(e.client_ts, e.received_at) at time zone 'UTC')::date as day,
  count(distinct e.device_id) filter (where e.name = 'app_open') as app_open,
  count(distinct e.device_id) filter (where e.name = 'onboarding_done') as onboarding_done,
  count(distinct e.device_id) filter (where e.name = 'first_log') as first_log,
  count(distinct e.device_id) filter (where e.name = 'paywall_view') as paywall_view,
  count(distinct e.device_id) filter (where e.name = 'trial_started') as trial_started,
  count(distinct e.device_id) filter (where e.name = 'health_connected') as health_connected,
  count(distinct e.device_id) filter (where e.name = 'insights_view') as insights_view
from public.app_events e
where e.name in (
  'app_open', 'onboarding_done', 'first_log', 'paywall_view',
  'trial_started', 'health_connected', 'insights_view'
)
group by 1;

-- One row per RevenueCat customer who started a free trial. Grouped by
-- original_app_user_id rather than the per-event device_id, so a device_id
-- attribute that reached RevenueCat only after the purchase still links the
-- trial to the device (device_id = the latest one seen for that customer).
-- converted: a RENEWAL or a NORMAL period event at or after the trial start.
create or replace view public.v_trial_cohort
with (security_invoker = true) as
with ev as (
  select
    coalesce(s.original_app_user_id, s.app_user_id) as customer,
    s.type, s.period_type, s.device_id, s.product_id,
    s.event_at, s.purchased_at, s.expiration_at, s.cancel_reason
  from public.subscription_events s
  where s.environment = 'PRODUCTION'
),
trial as (
  select distinct on (ev.customer)
    ev.customer,
    ev.product_id,
    coalesce(ev.purchased_at, ev.event_at) as trial_started_at,
    ev.expiration_at as trial_ends_at
  from ev
  where ev.type = 'INITIAL_PURCHASE' and ev.period_type = 'TRIAL' and ev.customer is not null
  order by ev.customer, coalesce(ev.purchased_at, ev.event_at)
)
select
  (
    select d.device_id from ev d
    where d.customer = t.customer and d.device_id is not null
    order by d.event_at desc
    limit 1
  ) as device_id,
  t.customer as original_app_user_id,
  t.product_id,
  t.trial_started_at,
  t.trial_ends_at,
  c.cancelled_at,
  c.cancel_reason,
  floor(extract(epoch from (c.cancelled_at - t.trial_started_at)) / 86400)::integer as days_to_cancel,
  exists (
    select 1 from ev r
    where r.customer = t.customer
      and r.event_at >= t.trial_started_at
      and (r.type = 'RENEWAL' or r.period_type = 'NORMAL')
  ) as converted
from trial t
left join lateral (
  select x.event_at as cancelled_at, x.cancel_reason
  from ev x
  where x.customer = t.customer
    and x.type = 'CANCELLATION'
    and x.event_at >= t.trial_started_at
  order by x.event_at
  limit 1
) c on true;

-- For every device that cancelled (first CANCELLATION per device), the last 5
-- app events before it. n_before = 1 is the event closest to the cancellation.
create or replace view public.v_pre_cancel_events
with (security_invoker = true) as
with first_cancel as (
  select distinct on (s.device_id)
    s.device_id, s.event_at as cancelled_at, s.cancel_reason, s.period_type, s.product_id
  from public.subscription_events s
  where s.type = 'CANCELLATION' and s.environment = 'PRODUCTION' and s.device_id is not null
  order by s.device_id, s.event_at
)
select
  c.device_id,
  c.cancelled_at,
  c.cancel_reason,
  c.period_type,
  c.product_id,
  p.n_before,
  p.name,
  p.props,
  p.event_at,
  p.app_version,
  p.is_pro
from first_cancel c
cross join lateral (
  select
    row_number() over (order by last5.event_at desc) as n_before,
    last5.*
  from (
    select a.name, a.props, coalesce(a.client_ts, a.received_at) as event_at, a.app_version, a.is_pro
    from public.app_events a
    where a.device_id = c.device_id
      and coalesce(a.client_ts, a.received_at) < c.cancelled_at
    order by coalesce(a.client_ts, a.received_at) desc
    limit 5
  ) last5
) p;

revoke all on public.v_funnel_daily, public.v_trial_cohort, public.v_pre_cancel_events from anon, authenticated;
