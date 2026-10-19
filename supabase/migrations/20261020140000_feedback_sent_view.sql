-- Weekly report view for the feedback_sent analytics event: how often each kind and
-- cancellation reason code is sent, per UTC day. Counts only; the table reads the two
-- enum props of the event (never a message or a contact), and only consented devices
-- appear in app_events. The full-coverage feedback rows stay in public.feedback.
--
-- Idempotent: create or replace, repeatable revoke.

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
group by 1, 2, 3;

revoke all on public.v_feedback_sent_daily from anon, authenticated;
