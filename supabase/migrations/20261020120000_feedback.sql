-- In-app feedback: suggestions, bug reports, other notes and the cancellation survey.
--
-- public.feedback holds what the user chose to send: a kind, an optional reason code
-- (cancel_survey only), an optional message (2000 characters at most) and, only if the
-- user typed one, a contact e-mail. install_id is the anonymous per-install uuid (the
-- same x-device-id track and delete-device receive), so delete_device_data_v2 can remove
-- it. RLS on, no policies: only the service role (the feedback edge function) writes.
-- Retention is 180 days (purge_feedback, cron purge-feedback 03:37 UTC).
--
-- feedback_usage are the hourly request counters of the edge function (keyed daily
-- hashes of the client IP and the install id, never the raw values), same mold as
-- delete_usage. feedback_submit() counts the request and inserts the row in one
-- transaction.
--
-- delete_device_data_v2 is replaced (create or replace, everything from
-- 20261019100000 kept) so a deletion also removes the install's feedback rows; the
-- result gains a 'feedback' count.
--
-- Idempotent: if not exists, create or replace, repeatable grants and cron job.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  install_id text not null
    check (install_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  kind text not null
    check (kind in ('suggestion', 'bug', 'other', 'cancel_survey')),
  reason_code text
    check (reason_code in ('expensive', 'not_used', 'missing_feature', 'bug', 'other_app', 'other')),
  message text
    check (char_length(message) <= 2000 and message !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
  contact_email text
    check (char_length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  app_version text check (char_length(app_version) <= 32),
  platform text check (platform in ('ios', 'android')),
  locale text check (char_length(locale) <= 35),
  constraint feedback_reason_only_survey check (reason_code is null or kind = 'cancel_survey')
);

create index if not exists feedback_created_at_idx on public.feedback (created_at);
create index if not exists feedback_install_id_idx on public.feedback (install_id);

alter table public.feedback enable row level security;
revoke all on table public.feedback from anon, authenticated;
grant select, insert, update, delete on table public.feedback to service_role;

create table if not exists public.feedback_usage (
  bucket text not null,
  hour_start timestamptz not null,
  requests integer not null default 0,
  primary key (bucket, hour_start)
);

create index if not exists feedback_usage_hour_idx on public.feedback_usage (hour_start);

alter table public.feedback_usage enable row level security;
revoke all on table public.feedback_usage from anon, authenticated;
grant select, insert, update, delete on table public.feedback_usage to service_role;

-- Counts one valid submission against the IP and the install and, if both are under
-- their hourly caps, stores the row. Returns 1 stored, -1 over a cap. The IP goes
-- first so a caller rotating install ids stops at the IP cap. Each counter is one
-- atomic upsert; a refused request is still counted, so a flood counts against itself.
create or replace function public.feedback_submit(
  p_install_id text,
  p_ip_bucket text,
  p_install_bucket text,
  p_row jsonb,
  p_max_ip integer,
  p_max_install integer
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_hour timestamptz := date_trunc('hour', now(), 'UTC');
  v_requests integer;
begin
  insert into public.feedback_usage as u (bucket, hour_start, requests)
  values ('i:' || p_ip_bucket, v_hour, 1)
  on conflict (bucket, hour_start) do update set requests = u.requests + 1
  returning u.requests into v_requests;
  if v_requests > p_max_ip then
    return -1;
  end if;

  insert into public.feedback_usage as u (bucket, hour_start, requests)
  values ('d:' || p_install_bucket, v_hour, 1)
  on conflict (bucket, hour_start) do update set requests = u.requests + 1
  returning u.requests into v_requests;
  if v_requests > p_max_install then
    return -1;
  end if;

  insert into public.feedback (install_id, kind, reason_code, message, contact_email, app_version, platform, locale)
  values (
    p_install_id,
    p_row->>'kind',
    p_row->>'reason_code',
    p_row->>'message',
    p_row->>'contact_email',
    p_row->>'app_version',
    p_row->>'platform',
    p_row->>'locale'
  );
  return 1;
end;
$$;

revoke all on function public.feedback_submit(text, text, text, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.feedback_submit(text, text, text, jsonb, integer, integer) to service_role;

-- Retention: feedback rows after p_keep_days; the hourly counters after 2 days.
create or replace function public.purge_feedback(p_keep_days integer default 180)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from public.feedback
  where created_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_deleted = row_count;

  delete from public.feedback_usage
  where hour_start < now() - interval '2 days';

  return v_deleted;
end;
$$;

revoke all on function public.purge_feedback(integer) from public, anon, authenticated;
grant execute on function public.purge_feedback(integer) to service_role;

do $do$
declare
  v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname = 'purge-feedback' loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule('purge-feedback', '37 3 * * *', 'select public.purge_feedback(180)');
end
$do$;

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
    fb as (delete from public.feedback where install_id = p_device_id returning 1),
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
    'feedback', (select count(*) from fb),
    'subscription_events', (select count(*) from se)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.delete_device_data_v2(text, text) from public, anon, authenticated;
grant execute on function public.delete_device_data_v2(text, text) to service_role;
