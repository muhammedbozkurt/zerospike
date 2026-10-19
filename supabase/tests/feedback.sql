begin;

-- feedback table: constraints, rate limit counters, 180 day purge, delete_device_data_v2
-- coverage, no Data API access. Everything runs inside this transaction and is rolled
-- back, so no row survives. Run: supabase db query --linked -f supabase/tests/feedback.sql

create temp table t_res (step text, ok boolean, detail text);

do $t$
declare
  v_id constant text := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_other constant text := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_n integer;
  v_r integer;
  v_del jsonb;
  v_failed boolean;
begin
  -- (a) a valid row is stored through feedback_submit
  v_r := public.feedback_submit(v_id, 'ip-a', 'dev-a',
    '{"kind":"other","message":"smoke","platform":"ios","app_version":"2.3.8","locale":"tr"}'::jsonb, 30, 5);
  select count(*) into v_n from public.feedback where install_id = v_id;
  insert into t_res values ('a insert', v_r = 1 and v_n = 1, format('ret=%s rows=%s', v_r, v_n));

  -- (b) check constraints reject bad rows
  v_failed := false;
  begin insert into public.feedback (install_id, kind) values (v_id, 'nope'); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b bad kind', v_failed, null);

  v_failed := false;
  begin insert into public.feedback (install_id, kind) values ('not-a-uuid', 'other'); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b bad install_id', v_failed, null);

  v_failed := false;
  begin insert into public.feedback (install_id, kind, reason_code) values (v_id, 'cancel_survey', 'bogus'); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b bad reason_code', v_failed, null);

  v_failed := false;
  begin insert into public.feedback (install_id, kind, reason_code) values (v_id, 'bug', 'expensive'); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b reason only for cancel_survey', v_failed, null);

  v_failed := false;
  begin insert into public.feedback (install_id, kind, message) values (v_id, 'other', repeat('x', 2001)); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b message over 2000', v_failed, null);

  v_failed := false;
  begin insert into public.feedback (install_id, kind, message) values (v_id, 'other', repeat('x', 2000)); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b message exactly 2000 ok', not v_failed, null);

  v_failed := false;
  begin insert into public.feedback (install_id, kind, message) values (v_id, 'other', 'a' || chr(7) || 'b'); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b control character', v_failed, null);

  v_failed := false;
  begin insert into public.feedback (install_id, kind, contact_email) values (v_id, 'other', 'no-at-sign'); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b bad email', v_failed, null);

  v_failed := false;
  begin insert into public.feedback (install_id, kind, contact_email) values (v_id, 'other', repeat('a', 250) || '@b.co'); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b email over 254', v_failed, null);

  v_failed := false;
  begin insert into public.feedback (install_id, kind, platform) values (v_id, 'other', 'web'); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b bad platform', v_failed, null);

  v_failed := false;
  begin insert into public.feedback (install_id, kind, reason_code, contact_email) values (v_id, 'cancel_survey', 'not_used', 'a@b.co'); exception when check_violation then v_failed := true; end;
  insert into t_res values ('b valid survey ok', not v_failed, null);

  -- (c) install cap 2 per hour: third request refused
  perform public.feedback_submit(v_other, 'ip-c', 'dev-c', '{"kind":"other","message":"1"}'::jsonb, 30, 2);
  perform public.feedback_submit(v_other, 'ip-c', 'dev-c', '{"kind":"other","message":"2"}'::jsonb, 30, 2);
  v_r := public.feedback_submit(v_other, 'ip-c', 'dev-c', '{"kind":"other","message":"3"}'::jsonb, 30, 2);
  select count(*) into v_n from public.feedback where install_id = v_other;
  insert into t_res values ('c install cap', v_r = -1 and v_n = 2, format('ret=%s rows=%s', v_r, v_n));

  -- (d) ip cap 2: a second install behind the same ip is refused on the third
  perform public.feedback_submit(v_other, 'ip-d', 'dev-d1', '{"kind":"other","message":"1"}'::jsonb, 2, 5);
  perform public.feedback_submit(v_other, 'ip-d', 'dev-d2', '{"kind":"other","message":"2"}'::jsonb, 2, 5);
  v_r := public.feedback_submit(v_other, 'ip-d', 'dev-d3', '{"kind":"other","message":"3"}'::jsonb, 2, 5);
  insert into t_res values ('d ip cap', v_r = -1, format('ret=%s', v_r));

  -- (e) purge: 181 day old row goes, 179 day old stays, old counters go
  insert into public.feedback (install_id, kind, message, created_at) values
    ('aaaaaaaa-0000-4000-8000-000000000009', 'other', 'old', now() - interval '181 days'),
    ('aaaaaaaa-0000-4000-8000-000000000009', 'other', 'recent', now() - interval '179 days');
  insert into public.feedback_usage (bucket, hour_start, requests) values ('i:old', now() - interval '3 days', 1);
  select public.purge_feedback(180) into v_n;
  insert into t_res values ('e purge',
    v_n >= 1
    and not exists (select 1 from public.feedback where message = 'old')
    and exists (select 1 from public.feedback where message = 'recent')
    and not exists (select 1 from public.feedback_usage where bucket = 'i:old'),
    format('deleted=%s', v_n));

  -- (f) delete_device_data_v2 removes this install's rows in every store, 'ce:' counter
  -- included, and only this install's
  insert into public.app_events (device_id, name) values (v_id, 'k_test');
  insert into public.track_batches (device_id, batch_id) values (v_id, gen_random_uuid());
  insert into public.track_usage (device_id, hour_start) values (v_id, date_trunc('hour', now(), 'UTC'));
  insert into public.spike_usage (device_id, day, count) values (v_id, '2099-02-01', 1), ('ce:' || v_id, '2099-02-01', 1);
  insert into public.spike_calls (device_id, day, model) values (v_id, '2099-02-01', 'k-test');
  insert into public.subscription_events (rc_event_id, device_id) values ('k-test-' || v_id, v_id);
  insert into public.app_events (device_id, name) values (v_other, 'k_test');
  select count(*) into v_n from public.feedback where install_id = v_id;
  v_del := public.delete_device_data_v2(v_id, null);
  insert into t_res values ('f delete scope',
    (v_del->>'feedback')::integer = v_n and v_n >= 2
    and (v_del->>'app_events')::integer = 1
    and (v_del->>'track_batches')::integer = 1
    and (v_del->>'track_usage')::integer = 1
    and (v_del->>'spike_usage')::integer = 2
    and (v_del->>'spike_calls')::integer = 1
    and (v_del->>'subscription_events')::integer = 1
    and not exists (select 1 from public.feedback where install_id = v_id)
    and not exists (select 1 from public.spike_usage where device_id in (v_id, 'ce:' || v_id))
    and not exists (select 1 from public.app_events where device_id = v_id)
    and exists (select 1 from public.feedback where install_id = v_other)
    and exists (select 1 from public.app_events where device_id = v_other),
    v_del::text);
end
$t$;

insert into t_res
select 'g cron purge-feedback',
       count(*) = 1 and max(schedule) = '37 3 * * *' and max(command) = 'select public.purge_feedback(180)',
       coalesce(max(schedule), 'none')
from cron.job where jobname = 'purge-feedback';

insert into t_res
select 'h rls on, no policies',
       (select relrowsecurity from pg_class where oid = 'public.feedback'::regclass)
       and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'feedback') = 0,
       null;

set local role anon;
do $t$
begin
  create temp table if not exists t_anon (r text);
  begin
    perform count(*) from public.feedback;
    insert into t_anon values ('READ ALLOWED');
  exception when insufficient_privilege then
    insert into t_anon values ('denied');
  end;
end
$t$;
reset role;
insert into t_res select 'i anon denied', r = 'denied', r from t_anon;

select step, ok, detail from t_res order by step;

rollback;
