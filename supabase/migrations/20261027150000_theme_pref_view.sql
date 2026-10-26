-- Weekly report view for the theme_pref_set analytics event (schema v7): how many
-- devices chose light, dark or system, per UTC day. initial=true is the first
-- resolved default (new install: light, existing user: dark), initial=false is a
-- change made in Settings > Appearance; the two are kept apart on purpose.
-- Counts only; no health value, no identity beyond the device id that app_events
-- already holds, and only consented devices appear in app_events. Test devices
-- (public.test_devices) are left out like in the other views.
--
-- Idempotent: create or replace, repeatable revoke.

create or replace view public.v_theme_pref_daily
with (security_invoker = true) as
select
  (coalesce(e.client_ts, e.received_at) at time zone 'UTC')::date as day,
  e.props->>'pref' as pref,
  coalesce((e.props->>'initial')::boolean, false) as initial,
  count(*) as events,
  count(distinct e.device_id) as devices
from public.app_events e
where e.name = 'theme_pref_set'
  and e.app_version is not null
  and e.props->>'pref' in ('light', 'dark', 'system')
  and (e.props->>'initial') in ('true', 'false')
  and not exists (select 1 from public.test_devices t where t.device_id = e.device_id)
group by 1, 2, 3;

revoke all on public.v_theme_pref_daily from anon, authenticated;
