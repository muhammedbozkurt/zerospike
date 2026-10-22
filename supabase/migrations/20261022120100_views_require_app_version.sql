-- v_retention_cohort and v_event_daily ignore rows without an envelope
-- (app_version null): a hand-sent probe (curl smoke test) has no app_version and
-- must not count as a device. Real installs always send it. Same definitions as
-- 20261017120000_funnel_views.sql plus that one condition. The other views are
-- not touched here; test devices are handled for them in
-- 20261022130100_views_exclude_test_devices.sql.

create or replace view public.v_retention_cohort
with (security_invoker = true) as
with f as (
  select device_id, min((coalesce(client_ts, received_at) at time zone 'UTC')::date) as d0
  from public.app_events
  where app_version is not null
  group by 1
),
a as (
  select distinct device_id, (coalesce(client_ts, received_at) at time zone 'UTC')::date as d
  from public.app_events
  where name = 'app_open' and app_version is not null
)
select
  f.d0 as cohort_day,
  count(*) as n,
  count(*) filter (where exists (select 1 from a where a.device_id = f.device_id and a.d = f.d0 + 1)) as d1,
  count(*) filter (where exists (select 1 from a where a.device_id = f.device_id and a.d = f.d0 + 7)) as d7,
  count(*) filter (where exists (select 1 from a where a.device_id = f.device_id and a.d = f.d0 + 30)) as d30
from f
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
group by 1, 2;

revoke all on public.v_retention_cohort, public.v_event_daily from anon, authenticated;

comment on view public.v_event_daily is
  'Per-day event counts. name=analytics_opt_out is the opt-in moment (props.enabled=true); a refusal is never sent, so there is no row for it. Only consented devices ever appear here.';
