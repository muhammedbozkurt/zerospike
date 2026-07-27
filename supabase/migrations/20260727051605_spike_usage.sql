-- Spike server-side daily usage cap (R10 FAZ 2).
--
-- Tracks messages per anonymous device per UTC day, so the ai-ask-spike edge
-- function can enforce a per-device daily ceiling even if its URL leaks (the
-- client-side counter in lib/ai/spikeLimit.ts is trivially bypassable). No
-- health data, no identity — device_id is a random install-time uuid.

create table if not exists public.spike_usage (
  device_id text not null,
  day text not null,
  count integer not null default 0,
  primary key (device_id, day)
);

-- RLS enabled with NO policies: only the service role (used exclusively by the
-- edge function) can read or write this table. anon/authenticated get nothing.
alter table public.spike_usage enable row level security;

-- Atomic upsert+increment in one round trip, so two near-simultaneous requests
-- from the same device can never race a read-then-write increment.
create or replace function public.increment_spike_usage(p_device_id text, p_day text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.spike_usage (device_id, day, count)
  values (p_device_id, p_day, 1)
  on conflict (device_id, day)
  do update set count = spike_usage.count + 1
  returning count into new_count;
  return new_count;
end;
$$;

revoke execute on function public.increment_spike_usage(text, text) from public;
grant execute on function public.increment_spike_usage(text, text) to service_role;
