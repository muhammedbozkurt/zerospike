-- Device-counting views leave out the installs listed in public.test_devices
-- (20261022130000). Same column names, order and types as before, so
-- create or replace applies cleanly.
--
-- v_retention_cohort and v_event_daily keep the app_version-not-null condition of
-- 20261022120100 (hand-sent probes carry no envelope). The other views come from
-- 20261017120000 / 20261006094929 / 20261020140000 with only the new condition.
-- v_trial_cohort and v_pre_cancel_events are driven by RevenueCat PRODUCTION
-- purchases, which a test device never produces, and stay as they are.

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
  and not exists (select 1 from public.test_devices t where t.device_id = e.device_id)
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
  and not exists (select 1 from public.test_devices t where t.device_id = e.device_id)
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
  and not exists (select 1 from public.test_devices t where t.device_id = e.device_id)
group by 1, 2, 3;

create or replace view public.v_retention_cohort
with (security_invoker = true) as
with f as (
  select device_id, min((coalesce(client_ts, received_at) at time zone 'UTC')::date) as d0
  from public.app_events
  where app_version is not null
    and not exists (select 1 from public.test_devices t where t.device_id = app_events.device_id)
  group by 1
),
a as (
  select distinct device_id, (coalesce(client_ts, received_at) at time zone 'UTC')::date as d
  from public.app_events
  where name = 'app_open' and app_version is not null
    and not exists (select 1 from public.test_devices t where t.device_id = app_events.device_id)
)
select
  f.d0 as cohort_day,
  count(*) as n,
  count(*) filter (where exists (select 1 from a where a.device_id = f.device_id and a.d = f.d0 + 1)) as d1,
  count(*) filter (where exists (select 1 from a where a.device_id = f.device_id and a.d = f.d0 + 7)) as d7,
  count(*) filter (where exists (select 1 from a where a.device_id = f.device_id and a.d = f.d0 + 30)) as d30
from f
group by 1;

create or replace view public.v_third_log
with (security_invoker = true) as
with r as (
  select device_id,
         (coalesce(client_ts, received_at) at time zone 'UTC')::date as d,
         row_number() over (partition by device_id order by coalesce(client_ts, received_at), id) as rn
  from public.app_events
  where name = 'log_added'
    and not exists (select 1 from public.test_devices t where t.device_id = app_events.device_id)
)
select d as day, count(*) as devices
from r
where rn = 3
group by 1;

create or replace view public.v_event_daily
with (security_invoker = true) as
select
  (coalesce(e.client_ts, e.received_at) at time zone 'UTC')::date as day,
  e.name,
  count(*) as events,
  count(distinct e.device_id) as devices
from public.app_events e
where e.app_version is not null
  and not exists (select 1 from public.test_devices t where t.device_id = e.device_id)
group by 1, 2;

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
  and not exists (select 1 from public.test_devices t where t.device_id = e.device_id)
group by 1;

create or replace view public.v_feedback_sent_daily
with (security_invoker = true) as
select
  (coalesce(e.client_ts, e.received_at) at time zone 'UTC')::date as day,
  e.props->>'kind' as kind,
  e.props->>'reason_code' as reason_code,
  count(*) as events,
  count(distinct e.device_id) as devices
from public.app_events e
where e.name = 'feedback_sent'
  and not exists (select 1 from public.test_devices t where t.device_id = e.device_id)
group by 1, 2, 3;

revoke all on public.v_paywall_daily, public.v_purchase_results_daily,
  public.v_onboarding_dropoff, public.v_retention_cohort, public.v_third_log,
  public.v_event_daily, public.v_funnel_daily, public.v_feedback_sent_daily
  from anon, authenticated;

comment on view public.v_event_daily is
  'Per-day event counts. name=analytics_opt_out is the opt-in moment (props.enabled=true); a refusal is never sent, so there is no row for it. Only consented devices ever appear here; test_devices are left out.';
