-- Test devices: installs whose analytics must not be stored (developer phones,
-- emulators, store-review robots). The `track` function answers a batch from a
-- listed device 202 and writes nothing, and counts nothing against the rate
-- limits; the funnel views leave these devices out (20261022130100).
--
-- Service role only: RLS on, no policy, no grant for anon/authenticated.
-- Add a device with:
--   insert into public.test_devices (device_id, note) values ('<install uuid>', 'my iPhone') on conflict do nothing;
--
-- Idempotent: if not exists, repeatable grants.

create table if not exists public.test_devices (
  device_id text primary key,
  note text,
  created_at timestamptz not null default now()
);

alter table public.test_devices enable row level security;
revoke all on table public.test_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.test_devices to service_role;

comment on table public.test_devices is
  'Installs whose analytics are dropped by the track function and left out of the funnel views.';
