-- First-party Recovery Kit persistence.
-- Compatibility-safe foundation: legacy recovery remains unchanged while the
-- future first-party recovery path can operate entirely on app_users.
--
-- Recovery reset is a leased state machine. A verified challenge can have only
-- one active reset attempt at a time; the attempt must present its lease token
-- to finalize or abort. This prevents concurrent requests from both performing
-- the external password-reset side effect.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.app_account_recovery_kits (
  user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  key_id text NOT NULL UNIQUE CHECK (key_id ~ '^[0-9a-f]{32}$'),
  version smallint NOT NULL DEFAULT 1 CHECK (version = 1),
  secret_verifier text NOT NULL CHECK (secret_verifier ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.app_account_recovery_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','consuming','consumed','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  attempt_id uuid,
  lease_expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS app_account_recovery_challenges_user_idx
  ON public.app_account_recovery_challenges(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_account_recovery_challenges_expiry_idx
  ON public.app_account_recovery_challenges(expires_at);

CREATE TABLE IF NOT EXISTS public.app_account_recovery_rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);

ALTER TABLE public.app_account_recovery_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_account_recovery_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_account_recovery_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_account_recovery_kits FROM public, anon, authenticated;
REVOKE ALL ON public.app_account_recovery_challenges FROM public, anon, authenticated;
REVOKE ALL ON public.app_account_recovery_rate_limits FROM public, anon, authenticated;
GRANT ALL ON public.app_account_recovery_kits TO service_role;
GRANT ALL ON public.app_account_recovery_challenges TO service_role;
GRANT ALL ON public.app_account_recovery_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.flashpag_rotate_app_recovery_kit(
  p_user_id uuid,
  p_key_id text,
  p_secret_verifier text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_account_recovery_kits
     SET status = 'revoked', revoked_at = now(), rotated_at = now()
   WHERE user_id = p_user_id AND status = 'active';

  INSERT INTO public.app_account_recovery_kits(user_id, key_id, version, secret_verifier, status, created_at)
  VALUES (p_user_id, p_key_id, 1, p_secret_verifier, 'active', now());

  UPDATE public.app_account_recovery_challenges
     SET status = 'expired', attempt_id = NULL, lease_expires_at = NULL
   WHERE user_id = p_user_id AND status IN ('verified', 'consuming');
END;
$$;

CREATE OR REPLACE FUNCTION public.flashpag_begin_app_recovery_reset(
  p_challenge_id uuid,
  p_token_hash text,
  p_lease_ttl interval DEFAULT interval '2 minutes'
)
RETURNS TABLE(user_id uuid, key_id text, status text, attempt_id uuid, lease_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  current_status text;
  current_user_id uuid;
  current_key_id text;
  current_attempt_id uuid;
  current_lease_expires_at timestamptz;
  now_value timestamptz := now();
  challenge_expires_at timestamptz;
BEGIN
  SELECT c.status, c.user_id, c.key_id, c.attempt_id, c.lease_expires_at, c.expires_at
    INTO current_status, current_user_id, current_key_id, current_attempt_id, current_lease_expires_at, challenge_expires_at
    FROM public.app_account_recovery_challenges c
   WHERE c.id = p_challenge_id AND c.token_hash = p_token_hash
   FOR UPDATE;

  IF current_status IS NULL THEN RETURN; END IF;

  IF current_status = 'verified' THEN
    IF challenge_expires_at <= now_value OR NOT EXISTS (
      SELECT 1 FROM public.app_account_recovery_kits k
       WHERE k.user_id = current_user_id AND k.key_id = current_key_id AND k.status = 'active'
    ) THEN
      IF challenge_expires_at <= now_value THEN
        UPDATE public.app_account_recovery_challenges SET status = 'expired' WHERE id = p_challenge_id;
      END IF;
      RETURN;
    END IF;

    current_attempt_id := gen_random_uuid();
    current_lease_expires_at := LEAST(challenge_expires_at, now_value + greatest(interval '30 seconds', p_lease_ttl));
    UPDATE public.app_account_recovery_challenges
       SET status = 'consuming', attempt_id = current_attempt_id, lease_expires_at = current_lease_expires_at
     WHERE id = p_challenge_id AND status = 'verified';
    IF NOT FOUND THEN RETURN; END IF;
    current_status := 'consuming';
  ELSIF current_status = 'consuming' THEN
    IF current_lease_expires_at IS NULL OR current_lease_expires_at <= now_value THEN
      IF challenge_expires_at <= now_value THEN
        UPDATE public.app_account_recovery_challenges SET status = 'expired', attempt_id = NULL, lease_expires_at = NULL WHERE id = p_challenge_id;
        RETURN;
      END IF;
      current_attempt_id := gen_random_uuid();
      current_lease_expires_at := LEAST(challenge_expires_at, now_value + greatest(interval '30 seconds', p_lease_ttl));
      UPDATE public.app_account_recovery_challenges
         SET attempt_id = current_attempt_id, lease_expires_at = current_lease_expires_at
       WHERE id = p_challenge_id AND status = 'consuming';
    ELSE
      RETURN;
    END IF;
  ELSE
    RETURN;
  END IF;

  RETURN QUERY SELECT current_user_id, current_key_id, current_status, current_attempt_id, current_lease_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.flashpag_finalize_app_recovery_reset(
  p_challenge_id uuid,
  p_user_id uuid,
  p_key_id text,
  p_attempt_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_account_recovery_challenges
     SET status = 'consumed', consumed_at = now(), attempt_id = NULL, lease_expires_at = NULL
   WHERE id = p_challenge_id AND user_id = p_user_id AND key_id = p_key_id
     AND attempt_id = p_attempt_id AND status = 'consuming' AND lease_expires_at > now();
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.app_account_recovery_kits
     SET status = 'used', used_at = now(), revoked_at = now()
   WHERE user_id = p_user_id AND key_id = p_key_id AND status = 'active';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.flashpag_abort_app_recovery_reset(
  p_challenge_id uuid,
  p_user_id uuid,
  p_key_id text,
  p_attempt_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.app_account_recovery_challenges
     SET status = 'verified', attempt_id = NULL, lease_expires_at = NULL
   WHERE id = p_challenge_id AND user_id = p_user_id AND key_id = p_key_id
     AND attempt_id = p_attempt_id AND status = 'consuming'
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION public.flashpag_app_recovery_rate_limit(
  p_subject_hash text,
  p_ip_hash text,
  p_subject_limit integer DEFAULT 5,
  p_ip_limit integer DEFAULT 20
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE subject_count integer; ip_count integer; now_value timestamptz := now();
BEGIN
  INSERT INTO public.app_account_recovery_rate_limits(bucket_key, window_started_at, attempt_count)
  VALUES (p_subject_hash, now_value, 1)
  ON CONFLICT (bucket_key) DO UPDATE SET
    attempt_count = CASE WHEN public.app_account_recovery_rate_limits.window_started_at <= now_value - interval '10 minutes' THEN 1 ELSE public.app_account_recovery_rate_limits.attempt_count + 1 END,
    window_started_at = CASE WHEN public.app_account_recovery_rate_limits.window_started_at <= now_value - interval '10 minutes' THEN now_value ELSE public.app_account_recovery_rate_limits.window_started_at END
  RETURNING attempt_count INTO subject_count;

  INSERT INTO public.app_account_recovery_rate_limits(bucket_key, window_started_at, attempt_count)
  VALUES (p_ip_hash, now_value, 1)
  ON CONFLICT (bucket_key) DO UPDATE SET
    attempt_count = CASE WHEN public.app_account_recovery_rate_limits.window_started_at <= now_value - interval '10 minutes' THEN 1 ELSE public.app_account_recovery_rate_limits.attempt_count + 1 END,
    window_started_at = CASE WHEN public.app_account_recovery_rate_limits.window_started_at <= now_value - interval '10 minutes' THEN now_value ELSE public.app_account_recovery_rate_limits.window_started_at END
  RETURNING attempt_count INTO ip_count;

  RETURN subject_count <= greatest(1, p_subject_limit) AND ip_count <= greatest(1, p_ip_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.flashpag_rotate_app_recovery_kit(uuid,text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.flashpag_begin_app_recovery_reset(uuid,text,interval) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.flashpag_finalize_app_recovery_reset(uuid,uuid,text,uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.flashpag_abort_app_recovery_reset(uuid,uuid,text,uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.flashpag_app_recovery_rate_limit(text,text,integer,integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flashpag_rotate_app_recovery_kit(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.flashpag_begin_app_recovery_reset(uuid,text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.flashpag_finalize_app_recovery_reset(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.flashpag_abort_app_recovery_reset(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.flashpag_app_recovery_rate_limit(text,text,integer,integer) TO service_role;
