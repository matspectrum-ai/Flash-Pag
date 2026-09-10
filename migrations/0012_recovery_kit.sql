create extension if not exists pgcrypto;

create table if not exists public.account_recovery_kits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  key_id text not null unique check (key_id ~ '^[0-9a-f]{32}$'),
  version smallint not null default 1 check (version = 1),
  secret_verifier text not null check (secret_verifier ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active','used','revoked')),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.account_recovery_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key_id text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'verified' check (status in ('verified','consuming','consumed','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists account_recovery_challenges_user_idx
  on public.account_recovery_challenges(user_id, created_at desc);
create index if not exists account_recovery_challenges_expiry_idx
  on public.account_recovery_challenges(expires_at);

alter table public.account_recovery_kits enable row level security;
alter table public.account_recovery_challenges enable row level security;
revoke all on public.account_recovery_kits from public, anon, authenticated;
revoke all on public.account_recovery_challenges from public, anon, authenticated;
grant all on public.account_recovery_kits to service_role;
grant all on public.account_recovery_challenges to service_role;

create or replace function public.flashpag_rotate_recovery_kit(
  p_user_id uuid,
  p_key_id text,
  p_secret_verifier text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_recovery_kits
  set status = 'revoked', revoked_at = now(), rotated_at = now()
  where user_id = p_user_id and status = 'active';

  insert into public.account_recovery_kits(user_id, key_id, version, secret_verifier, status, created_at)
  values (p_user_id, p_key_id, 1, p_secret_verifier, 'active', now());

  update public.account_recovery_challenges
  set status = 'expired'
  where user_id = p_user_id and status in ('verified','consuming');
end;
$$;

create or replace function public.flashpag_begin_recovery_reset(
  p_challenge_id uuid,
  p_token_hash text
)
returns table(user_id uuid, key_id text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  current_user_id uuid;
  current_key_id text;
begin
  select c.status, c.user_id, c.key_id
    into current_status, current_user_id, current_key_id
  from public.account_recovery_challenges c
  where c.id = p_challenge_id and c.token_hash = p_token_hash
  for update;

  if current_status is null then
    return;
  end if;

  if current_status = 'verified' then
    update public.account_recovery_challenges
    set status = 'consuming'
    where id = p_challenge_id and expires_at > now();
    if not found then
      return;
    end if;
    current_status := 'consuming';
  elsif current_status not in ('consuming','consumed') then
    return;
  end if;

  return query select current_user_id, current_key_id, current_status;
end;
$$;

create or replace function public.flashpag_finalize_recovery_reset(
  p_challenge_id uuid,
  p_user_id uuid,
  p_key_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_recovery_challenges
  set status = 'consumed', consumed_at = now()
  where id = p_challenge_id and user_id = p_user_id and key_id = p_key_id and status = 'consuming';
  if not found then
    return false;
  end if;

  update public.account_recovery_kits
  set status = 'used', used_at = now(), revoked_at = now()
  where user_id = p_user_id and key_id = p_key_id and status = 'active';
  return found;
end;
$$;

create or replace function public.flashpag_abort_recovery_reset(
  p_challenge_id uuid,
  p_user_id uuid,
  p_key_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.account_recovery_challenges
  set status = 'verified'
  where id = p_challenge_id and user_id = p_user_id and key_id = p_key_id and status = 'consuming'
  returning true;
$$;

create or replace function public.flashpag_auth_session_active(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from auth.sessions where id = p_session_id);
$$;

revoke all on function public.flashpag_rotate_recovery_kit(uuid,text,text) from public, anon, authenticated;
revoke all on function public.flashpag_begin_recovery_reset(uuid,text) from public, anon, authenticated;
revoke all on function public.flashpag_finalize_recovery_reset(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.flashpag_abort_recovery_reset(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.flashpag_auth_session_active(uuid) from public, anon, authenticated;
grant execute on function public.flashpag_rotate_recovery_kit(uuid,text,text) to service_role;
grant execute on function public.flashpag_begin_recovery_reset(uuid,text) to service_role;
grant execute on function public.flashpag_finalize_recovery_reset(uuid,uuid,text) to service_role;
grant execute on function public.flashpag_abort_recovery_reset(uuid,uuid,text) to service_role;
grant execute on function public.flashpag_auth_session_active(uuid) to service_role;

create table if not exists public.account_recovery_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

alter table public.account_recovery_rate_limits enable row level security;
revoke all on public.account_recovery_rate_limits from public, anon, authenticated;
grant all on public.account_recovery_rate_limits to service_role;

create or replace function public.flashpag_recovery_rate_limit(
  p_subject_hash text,
  p_ip_hash text,
  p_subject_limit integer default 5,
  p_ip_limit integer default 20
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject_count integer;
  ip_count integer;
  now_value timestamptz := now();
begin
  insert into public.account_recovery_rate_limits(bucket_key, window_started_at, attempt_count)
  values (p_subject_hash, now_value, 1)
  on conflict (bucket_key) do update
    set attempt_count = case
      when public.account_recovery_rate_limits.window_started_at <= now_value - interval '10 minutes' then 1
      else public.account_recovery_rate_limits.attempt_count + 1
    end,
    window_started_at = case
      when public.account_recovery_rate_limits.window_started_at <= now_value - interval '10 minutes' then now_value
      else public.account_recovery_rate_limits.window_started_at
    end
  returning attempt_count into subject_count;

  insert into public.account_recovery_rate_limits(bucket_key, window_started_at, attempt_count)
  values (p_ip_hash, now_value, 1)
  on conflict (bucket_key) do update
    set attempt_count = case
      when public.account_recovery_rate_limits.window_started_at <= now_value - interval '10 minutes' then 1
      else public.account_recovery_rate_limits.attempt_count + 1
    end,
    window_started_at = case
      when public.account_recovery_rate_limits.window_started_at <= now_value - interval '10 minutes' then now_value
      else public.account_recovery_rate_limits.window_started_at
    end
  returning attempt_count into ip_count;

  return subject_count <= greatest(1, p_subject_limit) and ip_count <= greatest(1, p_ip_limit);
end;
$$;

revoke all on function public.flashpag_recovery_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.flashpag_recovery_rate_limit(text,text,integer,integer) to service_role;
