-- Consume a TOTP timestep and elevate the same session as one database transaction.
-- The function is atomic: either both state changes happen, or neither does.

create or replace function public.flashpag_consume_totp_and_elevate_session(
  p_user_id uuid,
  p_session_token_hash text,
  p_step bigint,
  p_verified_at timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.app_totp_factors
     set last_used_step = p_step,
         last_used_at = p_verified_at,
         updated_at = p_verified_at
   where user_id = p_user_id
     and enabled_at is not null
     and disabled_at is null
     and (last_used_step is null or last_used_step < p_step);

  if not found then
    return false;
  end if;

  update public.app_sessions
     set aal = 'aal2',
         mfa_verified_at = p_verified_at,
         last_seen_at = p_verified_at
   where token_hash = p_session_token_hash
     and user_id = p_user_id
     and revoked_at is null
     and expires_at > p_verified_at
     and aal = 'aal1';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'mfa_session_elevation_failed';
  end if;

  return true;
end;
$$;

revoke all on function public.flashpag_consume_totp_and_elevate_session(uuid, text, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.flashpag_consume_totp_and_elevate_session(uuid, text, bigint, timestamptz) to service_role;
