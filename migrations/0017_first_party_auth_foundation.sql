-- First-party identity foundation.
-- Runtime authentication is not switched in this migration. Existing Supabase Auth remains
-- the compatibility source until the staged cutover is validated end-to-end.

create table if not exists public.app_users (
  id uuid primary key,
  username text not null,
  username_normalized text not null,
  status text not null default 'active' check (status in ('active','blocked','disabled')),
  legacy_auth_user_id uuid,
  legacy_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (username_normalized = lower(username_normalized)),
  check (char_length(username_normalized) between 3 and 32),
  check (username_normalized ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$')
);

create unique index if not exists app_users_username_normalized_uidx
  on public.app_users(username_normalized);
create unique index if not exists app_users_legacy_auth_uidx
  on public.app_users(legacy_auth_user_id)
  where legacy_auth_user_id is not null;

-- Existing identities receive a deterministic non-email username during migration.
-- Users can change this username later through the first-party profile contract.
insert into public.app_users (id, username, username_normalized, legacy_auth_user_id, legacy_email)
select
  u.id,
  'user-' || replace(left(u.id::text, 12), '-', ''),
  'user-' || replace(left(u.id::text, 12), '-', ''),
  u.id,
  lower(trim(u.email))
from auth.users u
where not exists (
  select 1 from public.app_users a where a.id = u.id
);

create table if not exists public.app_password_credentials (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  password_hash text,
  password_scheme text not null default 'argon2id'
    check (password_scheme in ('argon2id')),
  password_version smallint not null default 1 check (password_version = 1),
  must_change boolean not null default false,
  changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Browser sessions are opaque bearer credentials. Only SHA-256 hashes are persisted.
-- Token rotation/reuse detection will be implemented in the service layer before cutover.
create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  ip_hash text,
  user_agent_hash text
);
create index if not exists app_sessions_user_idx on public.app_sessions(user_id, created_at desc);
create index if not exists app_sessions_active_idx on public.app_sessions(user_id, expires_at)
  where revoked_at is null;

-- TOTP metadata is first-party, but the secret must always be stored encrypted by the Go service.
create table if not exists public.app_totp_factors (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  secret_ciphertext text not null,
  issuer text not null default 'Flash Pag',
  account_label text not null,
  enabled_at timestamptz,
  disabled_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auth/security events are append-only application evidence. Sensitive credentials/tokens must
-- never be written into metadata by the service layer.
create table if not exists public.app_auth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete set null,
  action text not null,
  result text not null,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists app_auth_events_user_created_idx
  on public.app_auth_events(user_id, created_at desc);
create index if not exists app_auth_events_action_created_idx
  on public.app_auth_events(action, created_at desc);

-- Password/session/auth tables are backend-only. RLS is enabled as a defensive boundary.
do $$
declare r record;
begin
  for r in select tablename from pg_tables
           where schemaname='public'
             and tablename in ('app_users','app_password_credentials','app_sessions','app_totp_factors','app_auth_events')
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on public.%I from public, anon, authenticated', r.tablename);
  end loop;
end $$;

grant all on public.app_users to service_role;
grant all on public.app_password_credentials to service_role;
grant all on public.app_sessions to service_role;
grant all on public.app_totp_factors to service_role;
grant all on public.app_auth_events to service_role;

comment on table public.app_users is 'First-party Flash Pag identity; Supabase Auth compatibility fields are temporary migration state.';
comment on column public.app_users.legacy_auth_user_id is 'Temporary migration mapping to the former Supabase Auth identity; no application runtime logic should depend on it after cutover.';
comment on column public.app_users.legacy_email is 'Temporary migration field; email is not the first-party login identifier.';
comment on table public.app_sessions is 'Opaque first-party browser sessions; only credential hashes are persisted.';
comment on table public.app_totp_factors is 'First-party TOTP factor metadata; secret_ciphertext must be encrypted by the Go application.';
