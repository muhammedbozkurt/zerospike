-- One-off cleanup of the 9 manual smoke-test rows (2026-10-18 13:20-13:24 UTC):
-- bare app_open events sent by hand, so they carry no envelope (app_version and
-- platform null) and empty props. They inflated the device counts of the funnel
-- views. The condition is deliberately narrow: a real install always sends
-- app_version and platform, so nothing else can match.
delete from public.app_events
where app_version is null
  and platform is null
  and name = 'app_open'
  and props = '{}'::jsonb
  and received_at between '2026-10-18 13:15+00' and '2026-10-18 13:30+00';
