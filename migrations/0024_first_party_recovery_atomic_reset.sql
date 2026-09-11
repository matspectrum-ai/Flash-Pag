-- Atomic first-party recovery finalization.
-- Password replacement, TOTP removal, session revocation, challenge consumption,
-- and Recovery Kit invalidation are one database transaction.

CREATE OR REPLACE FUNCTION public.flashpag_apply_app_recovery_reset(
  p_challenge_id uuid,
  p_user_id uuid,
  p_key_id text,
  p_attempt_id uuid,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  challenge_user_id uuid;
  challenge_key_id text;
  challenge_status text;
  challenge_attempt_id uuid;
  challenge_lease_expires_at timestamptz;
  challenge_expires_at timestamptz;
  kit_exists boolean;
BEGIN
  IF coalesce(trim(p_password_hash), '') = '' THEN
    RETURN false;
  END IF;

  SELECT c.user_id, c.key_id, c.status, c.attempt_id, c.lease_expires_at, c.expires_at
    INTO challenge_user_id, challenge_key_id, challenge_status, challenge_attempt_id,
         challenge_lease_expires_at, challenge_expires_at
    FROM public.app_account_recovery_challenges c
   WHERE c.id = p_challenge_id
   FOR UPDATE;

  IF challenge_user_id IS NULL
     OR challenge_user_id <> p_user_id
     OR challenge_key_id <> p_key_id
     OR challenge_status <> 'consuming'
     OR challenge_attempt_id <> p_attempt_id
     OR challenge_lease_expires_at IS NULL
     OR challenge_lease_expires_at <= now()
     OR challenge_expires_at <= now() THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.app_account_recovery_kits k
     WHERE k.user_id = p_user_id
       AND k.key_id = p_key_id
       AND k.status = 'active'
  ) INTO kit_exists;

  IF NOT kit_exists THEN
    RETURN false;
  END IF;

  INSERT INTO public.app_password_credentials(
    user_id, password_hash, password_scheme, password_version,
    must_change, changed_at, updated_at
  )
  VALUES (
    p_user_id, p_password_hash, 'argon2id', 1,
    false, now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        password_scheme = EXCLUDED.password_scheme,
        password_version = EXCLUDED.password_version,
        must_change = false,
        changed_at = now(),
        updated_at = now();

  DELETE FROM public.app_totp_factors
   WHERE user_id = p_user_id;

  UPDATE public.app_sessions
     SET revoked_at = coalesce(revoked_at, now())
   WHERE user_id = p_user_id
     AND revoked_at IS NULL;

  UPDATE public.app_account_recovery_challenges
     SET status = 'consumed',
         consumed_at = now(),
         attempt_id = NULL,
         lease_expires_at = NULL
   WHERE id = p_challenge_id
     AND user_id = p_user_id
     AND key_id = p_key_id
     AND attempt_id = p_attempt_id
     AND status = 'consuming';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery challenge finalization conflict';
  END IF;

  UPDATE public.app_account_recovery_kits
     SET status = 'used',
         used_at = now(),
         revoked_at = now()
   WHERE user_id = p_user_id
     AND key_id = p_key_id
     AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery kit finalization conflict';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.flashpag_apply_app_recovery_reset(uuid,uuid,text,uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flashpag_apply_app_recovery_reset(uuid,uuid,text,uuid,text) TO service_role;
