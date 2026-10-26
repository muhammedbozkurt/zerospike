-- Spike 502 counter: how often the model failed and the user got a 502 upstream, next to
-- the 429 refusals already counted in spike_reject_usage. Same table, one more reason;
-- no identifier is stored (a row is UTC hour, reason, cap and a count; cap is 0 for
-- upstream because no ceiling is involved).
--
-- The function calls spike_count_upstream() as a call of its own, next to spike_release()
-- and not as a parameter of it, so a function deployed before this migration only loses
-- the count (the call fails and is swallowed) and still releases the slot.
--
-- v_spike_gate_daily is unchanged: it groups spike_reject_usage by reason, so 'upstream'
-- shows up there as its own reason row. purge_spike_logs() is unchanged too: it already
-- deletes every spike_reject_usage row older than 90 days, whatever the reason.
--
-- Idempotent: the constraint is dropped and re-added, the function uses create or replace,
-- grants are repeatable.

alter table public.spike_reject_usage drop constraint if exists spike_reject_usage_reason_check;
alter table public.spike_reject_usage
  add constraint spike_reject_usage_reason_check
  check (reason in ('ip', 'device', 'global', 'upstream'));

create or replace function public.spike_count_upstream()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.spike_reject_usage as r (hour_start, reason, cap, count)
  values (date_trunc('hour', now(), 'UTC'), 'upstream', 0, 1)
  on conflict (hour_start, reason, cap) do update set count = r.count + 1;
$$;

revoke execute on function public.spike_count_upstream() from public, anon, authenticated;
grant execute on function public.spike_count_upstream() to service_role;
