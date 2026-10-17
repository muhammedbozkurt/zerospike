-- Funnel measurement views over app_events (consented devices only).
-- Counts only: no device_id, no measurement values, no personal data leave
-- these views. security_invoker + revoke keeps them service-role only.
-- Purge schedules are unchanged. purchase_result / paywall_cta / variant are
-- app events added in schema v2; until the track function accepts them the
-- views simply return no rows for them.

create or replace view public.v_paywall_daily
with (security_invoker = true) as
select
  (coalesce(e.client_ts, e.received_at) at time zone 'UTC')::date as day,
  e.props->>'source' as reason,
  e.props->>'variant' as variant,
  count(*) as views,
  count(distinct e.device_id) as devices
from public.app_events e
where e.name = 'paywall_view'
group by 1, 2, 3;

create or replace view public.v_purchase_results_daily
with (security_invoker = true) as
select
  (coalesce(e.client_ts, e.received_at) at time zone 'UTC')::date as day,
  e.props->>'result' as result,
  e.props->>'product' as product,
  e.props->>'reason' as reason,
  count(*) as events,
  count(distinct e.device_id) as devices
from public.app_events e
where e.name = 'purchase_result'
group by 1, 2, 3, 4;

create or replace view public.v_onboarding_dropoff
with (security_invoker = true) as
select
  e.app_version,
  (e.props->>'index')::int as idx,
  e.props->>'step' as step,
  count(distinct e.device_id) as devices
from public.app_events e
where e.name = 'onboarding_step'
  and (e.props->>'index') ~ '^[0-9]{1,3}$'
group by 1, 2, 3;

-- Cohort = consented devices by first event day (D0 is the first consented
-- event, not the install day). d1/d7/d30: app_open exactly N days later.
-- Limit: app_events is purged at 180 days, so the cohort start (min event)
-- drifts forward with the purge (kohort baslangici 180 gun purge ile kayar).
create or replace view public.v_retention_cohort
with (security_invoker = true) as
with f as (
  select device_id, min((coalesce(client_ts, received_at) at time zone 'UTC')::date) as d0
  from public.app_events
  group by 1
),
a as (
  select distinct device_id, (coalesce(client_ts, received_at) at time zone 'UTC')::date as d
  from public.app_events
  where name = 'app_open'
)
select
  f.d0 as cohort_day,
  count(*) as n,
  count(*) filter (where exists (select 1 from a where a.device_id = f.device_id and a.d = f.d0 + 1)) as d1,
  count(*) filter (where exists (select 1 from a where a.device_id = f.device_id and a.d = f.d0 + 7)) as d7,
  count(*) filter (where exists (select 1 from a where a.device_id = f.device_id and a.d = f.d0 + 30)) as d30
from f
group by 1;

-- Third log: day on which a device's third log_added row arrived.
create or replace view public.v_third_log
with (security_invoker = true) as
with r as (
  select device_id,
         (coalesce(client_ts, received_at) at time zone 'UTC')::date as d,
         row_number() over (partition by device_id order by coalesce(client_ts, received_at), id) as rn
  from public.app_events
  where name = 'log_added'
)
select d as day, count(*) as devices
from r
where rn = 3
group by 1;

-- Generic per-day counts for single events without useful props (paywall_cta,
-- downsell_*, store_review_prompt, spike_message_sent, ...).
create or replace view public.v_event_daily
with (security_invoker = true) as
select
  (coalesce(e.client_ts, e.received_at) at time zone 'UTC')::date as day,
  e.name,
  count(*) as events,
  count(distinct e.device_id) as devices
from public.app_events e
group by 1, 2;

revoke all on public.v_paywall_daily, public.v_purchase_results_daily,
  public.v_onboarding_dropoff, public.v_retention_cohort, public.v_third_log,
  public.v_event_daily from anon, authenticated;
