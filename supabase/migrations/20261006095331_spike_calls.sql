-- Spike model call log (K3): one row per Bedrock call, for cost and latency
-- monitoring. No message text, no logbook summary, no glucose values: only
-- token counts, timing and whether the output gate replaced the reply.
-- device_id is the same random install uuid as spike_usage.

create table if not exists public.spike_calls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_id text not null,
  day text not null,                             -- UTC day key, same format as spike_usage.day
  model text not null,
  input_tokens integer not null default 0,       -- every prompt token, cached or not
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,  -- share of input_tokens read from the prompt cache
  cache_write_tokens integer not null default 0, -- share of input_tokens written to the prompt cache
  latency_ms integer not null default 0,
  filtered boolean not null default false,
  filter_rule text,                              -- filter rule id or 'refusal', never reply text
  stream boolean not null default false
);

create index if not exists spike_calls_day_idx on public.spike_calls (day);
create index if not exists spike_calls_created_at_idx on public.spike_calls (created_at);

-- RLS enabled with NO policies, and Supabase's default anon/authenticated
-- grants removed: only the service role (the edge function) touches this.
alter table public.spike_calls enable row level security;
revoke all on table public.spike_calls from anon, authenticated;
revoke all on sequence public.spike_calls_id_seq from anon, authenticated;
grant select, insert, delete on table public.spike_calls to service_role;
grant usage, select on sequence public.spike_calls_id_seq to service_role;

-- The usage counter RPC from 20260727051605 was still executable by anon and
-- authenticated through Supabase's default function privileges.
revoke execute on function public.increment_spike_usage(text, text) from anon, authenticated;

-- Retention: usage counters and call rows are deleted after 90 days.
create or replace function public.purge_spike_logs(p_keep_days integer default 90)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.spike_calls
   where created_at < now() - make_interval(days => p_keep_days);
  delete from public.spike_usage
   where day < to_char((now() at time zone 'utc')::date - p_keep_days, 'YYYY-MM-DD');
$$;

revoke execute on function public.purge_spike_logs(integer) from public, anon, authenticated;
grant execute on function public.purge_spike_logs(integer) to service_role;

-- Daily at 03:17 UTC when pg_cron is installed. Without pg_cron nothing is
-- scheduled here: enable it (Dashboard > Integrations > Cron), then run
--   select cron.schedule('spike-logs-retention', '17 3 * * *', 'select public.purge_spike_logs()');
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cmd$select cron.schedule('spike-logs-retention', '17 3 * * *', 'select public.purge_spike_logs()')$cmd$;
  end if;
end
$$;
