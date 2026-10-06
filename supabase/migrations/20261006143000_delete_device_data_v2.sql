-- delete-device v2: the subscription events recorded under the customer's own
-- RevenueCat app user id are deleted too.
--
-- delete_device_data() matched subscription_events on device_id alone. That
-- column is filled from the device_id attribute the app puts on the RevenueCat
-- customer, and the app takes the attribute off again while usage analytics is
-- off, so the events RevenueCat reported before it was set, or while it was off,
-- carry no device_id and survived a deletion. The app now also sends its
-- RevenueCat app user id (x-rc-app-user-id). This version deletes every
-- subscription event that carries the device id OR that app user id, as
-- app_user_id or as original_app_user_id (an alias can sit in either).
--
-- delete_device_data(text) from 20261006110710 stays as it is, for the function
-- version that is still deployed until the new one is live. Push this migration
-- BEFORE deploying delete-device: the new version calls delete_device_data_v2
-- and answers 503 until it exists.
--
-- Idempotent: create or replace, repeatable grants.

create or replace function public.delete_device_data_v2(
  p_device_id text,
  p_app_user_id text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_result jsonb;
  -- A blank id matches nothing, not every row whose column is blank.
  v_user text := nullif(btrim(coalesce(p_app_user_id, '')), '');
begin
  with
    ev as (delete from public.app_events where device_id = p_device_id returning 1),
    bt as (delete from public.track_batches where device_id = p_device_id returning 1),
    tu as (delete from public.track_usage where device_id = p_device_id returning 1),
    su as (delete from public.spike_usage where device_id = p_device_id returning 1),
    sc as (delete from public.spike_calls where device_id = p_device_id returning 1),
    se as (
      delete from public.subscription_events
      where device_id = p_device_id
         or (v_user is not null and (app_user_id = v_user or original_app_user_id = v_user))
      returning 1
    )
  select jsonb_build_object(
    'app_events', (select count(*) from ev),
    'track_batches', (select count(*) from bt),
    'track_usage', (select count(*) from tu),
    'spike_usage', (select count(*) from su),
    'spike_calls', (select count(*) from sc),
    'subscription_events', (select count(*) from se)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.delete_device_data_v2(text, text) from public, anon, authenticated;
grant execute on function public.delete_device_data_v2(text, text) to service_role;
