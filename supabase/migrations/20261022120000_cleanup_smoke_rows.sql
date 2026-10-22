-- One-off cleanup of the 9 manual smoke-test rows (sent by hand on 2026-10-18,
-- between 13:20 and 13:24 UTC): bare app_open events with no envelope (app_version
-- and platform null) and empty props. They inflated the device counts of the funnel
-- views. The condition is deliberately narrow: a real install always sends
-- app_version and platform, so nothing else can match. The delete window is
-- 2026-10-18 13:15 to 13:30 UTC, a margin around those minutes.
-- Safety: the rows are counted first. More than 9 matches means the condition is
-- catching something it should not, and the migration stops without deleting.
do $$
declare
  v_matches bigint;
begin
  select count(*) into v_matches
  from public.app_events
  where app_version is null
    and platform is null
    and name = 'app_open'
    and props = '{}'::jsonb
    and received_at between '2026-10-18 13:15+00' and '2026-10-18 13:30+00';

  if v_matches > 9 then
    raise exception 'cleanup_smoke_rows: % rows match, expected at most 9; nothing deleted', v_matches;
  end if;

  delete from public.app_events
  where app_version is null
    and platform is null
    and name = 'app_open'
    and props = '{}'::jsonb
    and received_at between '2026-10-18 13:15+00' and '2026-10-18 13:30+00';
end
$$;
