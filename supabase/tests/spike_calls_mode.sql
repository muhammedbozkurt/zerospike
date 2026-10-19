begin;

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

create temp table t_res (step text, ok boolean, detail text);

insert into public.spike_calls (device_id, day, model) values ('k27p5-old', '2099-02-01', 'm');
insert into public.spike_calls (device_id, day, model, mode) values ('k27p5-ce', '2099-02-01', 'm', 'carb_estimate');

insert into t_res
select 'a default chat', mode = 'chat', mode from public.spike_calls where device_id = 'k27p5-old';

insert into t_res
select 'b carb mode stored', mode = 'carb_estimate', mode from public.spike_calls where device_id = 'k27p5-ce';

do $t$
begin
  begin
    insert into public.spike_calls (device_id, day, model, mode) values ('k27p5-bad', '2099-02-01', 'm', 'other');
    insert into t_res values ('c bad mode rejected', false, 'inserted');
  exception when check_violation then
    insert into t_res values ('c bad mode rejected', true, 'check_violation');
  end;
end
$t$;

insert into t_res
select 'd column is not null default chat', is_nullable = 'NO' and column_default like '%chat%', column_default
from information_schema.columns where table_schema = 'public' and table_name = 'spike_calls' and column_name = 'mode';

do $t$
begin
  perform count(*) from public.v_spike_gate_daily;
  perform public.purge_spike_logs(90);
  insert into t_res values ('e views and purge still run', true, 'ok');
end
$t$;

insert into public.spike_usage (device_id, day, count) values ('k27p5-dev', '2099-02-01', 1), ('ce:k27p5-dev', '2099-02-01', 1);
insert into public.spike_calls (device_id, day, model, mode) values ('k27p5-dev', '2099-02-01', 'm', 'carb_estimate');
create temp table t_del as select public.delete_device_data_v2('k27p5-dev', null) as r;

insert into t_res
select 'f delete removes ce counter and calls',
       (r ->> 'spike_usage')::int = 2 and (r ->> 'spike_calls')::int = 1
         and not exists (select 1 from public.spike_usage where device_id in ('k27p5-dev', 'ce:k27p5-dev')),
       r::text
from t_del;

select step, ok, detail from t_res order by step;

rollback;
