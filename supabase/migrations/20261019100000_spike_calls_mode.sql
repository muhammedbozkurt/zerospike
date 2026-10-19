-- Spike call log: which mode a model call belonged to. 'chat' is the assistant;
-- 'carb_estimate' is the meal carbohydrate estimate (ai-ask-spike, mode carb_estimate).
-- Still no message text, meal text or answer: only the mode next to the token counts and timing.
--
-- Backward compatible: existing rows read 'chat' (the column default), and an older
-- function version that does not send `mode` keeps inserting 'chat'. No view or
-- function reads spike_calls columns by position, so v_* views and purge are untouched.
--
-- The carb daily counter lives in spike_usage under the key 'ce:<device id>' (the same
-- table and spike_reserve as chat, no schema change). delete_device_data_v2 is replaced
-- so a deletion also removes that 'ce:' counter row; the rest of it is unchanged.
--
-- Idempotent: add column if not exists, create or replace, repeatable grants.

alter table public.spike_calls
  add column if not exists mode text not null default 'chat'
  check (mode in ('chat', 'carb_estimate'));

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
    su as (delete from public.spike_usage where device_id in (p_device_id, 'ce:' || p_device_id) returning 1),
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
