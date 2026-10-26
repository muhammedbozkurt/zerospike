-- Dexcom resmi API baglantisi (2.5.0, bayrak varsayilan KAPALI). UYGULANMAZ: kullanici
-- `supabase db push` ile, Dexcom marka/ortaklik izni ve hukuk onayindan sonra uygular.
--
-- dexcom_links: bir kurulum (device_id, ayni x-device-id uuid'si) icin tek baglanti.
-- Dexcom, token'larin mobil cihazda degil ortak sunucuda saklanmasini ister; refresh
-- token (tek kullanimlik, her yenilemede doner) ve kisa omurlu access token AES-GCM ile
-- sifreli tutulur, anahtar yalniz function secrets'ta (DEXCOM_TOKEN_KEY). Cihaz yalniz
-- 256 bitlik baglanti sirrini tutar; tabloda onun SHA-256 ozeti durur. refresh_lease_until
-- eszamanli iki yenilemenin ayni tek kullanimlik token'i harcamasini engelleyen kisa kilittir.
--
-- dexcom_oauth_states: tek kullanimlik, 10 dakikalik OAuth state kayitlari (ozeti, ham
-- deger degil). dexcom_usage: saatlik istek sayaclari (anahtarli gunluk hash, ham IP ve
-- kurulum kimligi degil), delete_usage ile ayni kalip.
--
-- RLS acik, politika yok, anon/authenticated yetkisi yok: yalniz service role (dexcom-token).
-- Idempotent: if not exists, create or replace.

create table if not exists public.dexcom_links (
  link_id uuid primary key default gen_random_uuid(),
  device_id text not null unique
    check (device_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  link_secret_hash text not null check (link_secret_hash ~ '^[0-9a-f]{64}$'),
  region text not null check (region in ('us', 'ous', 'jp')),
  refresh_enc text not null,
  access_enc text,
  access_expires_at timestamptz,
  refresh_lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.dexcom_links enable row level security;
revoke all on table public.dexcom_links from anon, authenticated;
grant select, insert, update, delete on table public.dexcom_links to service_role;

create table if not exists public.dexcom_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  device_id text not null
    check (device_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  region text not null check (region in ('us', 'ous', 'jp')),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists dexcom_oauth_states_created_idx on public.dexcom_oauth_states (created_at);
create index if not exists dexcom_oauth_states_device_idx on public.dexcom_oauth_states (device_id);

alter table public.dexcom_oauth_states enable row level security;
revoke all on table public.dexcom_oauth_states from anon, authenticated;
grant select, insert, update, delete on table public.dexcom_oauth_states to service_role;

create table if not exists public.dexcom_usage (
  bucket text not null,
  hour_start timestamptz not null,
  requests integer not null default 0,
  primary key (bucket, hour_start)
);

create index if not exists dexcom_usage_hour_idx on public.dexcom_usage (hour_start);

alter table public.dexcom_usage enable row level security;
revoke all on table public.dexcom_usage from anon, authenticated;
grant select, insert, update, delete on table public.dexcom_usage to service_role;

-- Bir istegi IP ve kurulum sayacina yazar, limit icinde mi der. IP once gelir: kurulum
-- kimligi donduren bir cagri IP sinirinda durur. Her sayac tek atomik upsert. 2 gunden
-- eski sayaclar ve 1 gunden eski state kayitlari burada silinir (zamanlanmis is gerekmez).
create or replace function public.dexcom_request_allowed(
  p_device_bucket text,
  p_ip_bucket text,
  p_max_device integer,
  p_max_ip integer
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_hour timestamptz := date_trunc('hour', now(), 'UTC');
  v_requests integer;
begin
  delete from public.dexcom_usage where hour_start < now() - interval '2 days';
  delete from public.dexcom_oauth_states where created_at < now() - interval '1 day';

  insert into public.dexcom_usage as u (bucket, hour_start, requests)
  values ('i:' || p_ip_bucket, v_hour, 1)
  on conflict (bucket, hour_start) do update set requests = u.requests + 1
  returning u.requests into v_requests;
  if v_requests > p_max_ip then
    return false;
  end if;

  insert into public.dexcom_usage as u (bucket, hour_start, requests)
  values ('d:' || p_device_bucket, v_hour, 1)
  on conflict (bucket, hour_start) do update set requests = u.requests + 1
  returning u.requests into v_requests;

  return v_requests <= p_max_device;
end;
$$;

revoke all on function public.dexcom_request_allowed(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.dexcom_request_allowed(text, text, integer, integer) to service_role;
