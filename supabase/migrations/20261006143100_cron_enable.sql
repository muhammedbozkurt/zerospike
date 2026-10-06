-- Retention jobs: enable pg_cron and schedule the three daily purges.
--
-- The retention windows (app_events 180 days, the Spike counters and call log
-- 90 days, subscription_events 24 months with the raw webhook body cleared after
-- 90 days) only hold if the purge functions actually run. The migrations that
-- created them scheduled their job only when pg_cron was already enabled and
-- otherwise printed a notice, so on a project without the extension nothing ever
-- ran. This one enables the extension and (re)creates the jobs. It fails, rather
-- than skips, where pg_cron cannot be created: a retention promise that is not
-- being kept should stop the push, not pass quietly.
--
--   purge-app-events           03:17 UTC  purge_app_events(180)
--   purge-spike-logs           03:17 UTC  purge_spike_logs()            (90 days)
--   purge-subscription-events  03:27 UTC  purge_subscription_events(24, 90)
--
-- Idempotent: a job of the same name is unscheduled first, so a re-run (or a
-- project where an earlier migration or the dashboard already made one) ends
-- with exactly one of each. 'spike-logs-retention' is the name 20261006095331
-- used for the Spike job; it is replaced by purge-spike-logs, not kept next to it.

create extension if not exists pg_cron;

do $do$
declare
  v_job bigint;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'purge-app-events',
      'purge-spike-logs',
      'spike-logs-retention',
      'purge-subscription-events'
    )
  loop
    perform cron.unschedule(v_job);
  end loop;

  perform cron.schedule('purge-app-events', '17 3 * * *', 'select public.purge_app_events(180)');
  perform cron.schedule('purge-spike-logs', '17 3 * * *', 'select public.purge_spike_logs()');
  perform cron.schedule('purge-subscription-events', '27 3 * * *', 'select public.purge_subscription_events(24, 90)');
end
$do$;
