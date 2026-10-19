begin;

-- v_feedback_sent_daily groups feedback_sent events by day, kind and reason code,
-- ignores other events, and is closed to anon and authenticated.

create temp table t_res (step text, ok boolean, detail text);

insert into public.app_events (device_id, name, props, client_ts) values
  ('fbv-a', 'feedback_sent', '{"kind":"cancel_survey","reason_code":"expensive"}', '2099-03-01T10:00:00Z'),
  ('fbv-b', 'feedback_sent', '{"kind":"cancel_survey","reason_code":"expensive"}', '2099-03-01T11:00:00Z'),
  ('fbv-a', 'feedback_sent', '{"kind":"cancel_survey","reason_code":"expensive"}', '2099-03-01T12:00:00Z'),
  ('fbv-a', 'feedback_sent', '{"kind":"bug","reason_code":"none"}', '2099-03-01T13:00:00Z'),
  ('fbv-a', 'spike_opened', '{}', '2099-03-01T13:00:00Z');

insert into t_res
select 'a grouped counts',
       events = 3 and devices = 2,
       format('events=%s devices=%s', events, devices)
from public.v_feedback_sent_daily
where day = '2099-03-01' and kind = 'cancel_survey' and reason_code = 'expensive';

insert into t_res
select 'b other events excluded',
       count(*) = 2,
       format('rows=%s', count(*))
from public.v_feedback_sent_daily where day = '2099-03-01';

insert into t_res
select 'c closed to anon and authenticated',
       not has_table_privilege('anon', 'public.v_feedback_sent_daily', 'select')
         and not has_table_privilege('authenticated', 'public.v_feedback_sent_daily', 'select'),
       null;

select step, ok, detail from t_res order by step;

rollback;
