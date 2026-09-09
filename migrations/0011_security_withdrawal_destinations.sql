create extension if not exists pgcrypto;

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_id uuid references public.organizations(id) on delete set null,
  action text not null,
  result text not null check (result in ('succeeded','failed','pending')),
  created_at timestamptz not null default now()
);

create index if not exists security_events_user_created_idx on public.security_events(user_id, created_at desc);
create index if not exists security_events_org_created_idx on public.security_events(organization_id, created_at desc);

alter table public.security_events enable row level security;
revoke all on public.security_events from public, anon, authenticated;
grant all on public.security_events to service_role;

create table if not exists public.withdrawal_destinations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  pix_key_type text not null check (pix_key_type in ('cpf','cnpj','email','phone','evp','other')),
  pix_key_masked text not null,
  bank_name text not null,
  branch_last4 text not null default '',
  account_last4 text not null,
  account_type text not null check (account_type in ('checking','savings','payment')),
  details_ciphertext text not null,
  is_default boolean not null default true,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists withdrawal_destinations_default_idx
  on public.withdrawal_destinations(organization_id) where is_default and status = 'active';
create index if not exists withdrawal_destinations_org_idx
  on public.withdrawal_destinations(organization_id, created_at desc);

alter table public.withdrawal_destinations enable row level security;
revoke all on public.withdrawal_destinations from public, anon, authenticated;
grant all on public.withdrawal_destinations to service_role;
