-- First-party MFA persistence helpers.
-- A TOTP step is consumed atomically; concurrent requests cannot both elevate on the same code.

create or replace function public.flashpag_consume_totp_code(
  p_user_id uuid,
  p_step bigint,
  p_used_at timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.app_totp_factors
     set last_used_step = p_step,
         last_used_at = p_used_at,
         updated_at = p_used_at
   where user_id = p_user_id
     and enabled_at is not null
     and disabled_at is null
     and (last_used_step is null or last_used_step < p_step);

  return found;
end;
$$;

revoke all on function public.flashpag_consume_totp_code(uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.flashpag_consume_totp_code(uuid, bigint, timestamptz) to service_role;

create or replace function public.flashpag_elevate_auth_session(
  p_session_token_hash text,
  p_verified_at timestamptz
) returns boolean
language sql
security invoker
set search_path = public
as $$
  update public.app_sessions
     set aal = 'aal2',
         mfa_verified_at = p_verified_at,
         last_seen_at = p_verified_at
   where token_hash = p_session_token_hash
     and revoked_at is null
     and expires_at > p_verified_at
     and aal = 'aal1'
  returning true;
$$;

revoke all on function public.flashpag_elevate_auth_session(text, timestamptz) from public, anon, authenticated;
grant execute on function public.flashpag_elevate_auth_session(text, timestamptz) to service_role;
