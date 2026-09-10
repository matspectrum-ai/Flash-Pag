-- First-party authentication rate limiting.
-- Counters are keyed by the normalized username hash and source IP hash so the
-- application never needs to persist the raw credential identifier for throttling.
create table if not exists public.app_auth_rate_limits (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  username_hash text not null check (username_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  failures integer not null default 0 check (failures >= 0 and failures <= 1000),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists app_auth_rate_limits_updated_idx
  on public.app_auth_rate_limits(updated_at);

do $$
declare r record;
begin
  execute 'alter table public.app_auth_rate_limits enable row level security';
  execute 'revoke all on public.app_auth_rate_limits from public, anon, authenticated';
end $$;

grant all on public.app_auth_rate_limits to service_role;

comment on table public.app_auth_rate_limits is 'Backend-only login throttling state keyed by SHA-256 identifiers; raw usernames/IPs are never stored.';
