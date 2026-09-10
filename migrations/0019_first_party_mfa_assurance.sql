-- First-party MFA assurance state. This migration does not change the active Supabase
-- authentication path; it establishes persistence for the staged Go cutover.

ALTER TABLE app_sessions
  ADD COLUMN IF NOT EXISTS aal text NOT NULL DEFAULT 'aal1',
  ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;

ALTER TABLE app_sessions
  ADD CONSTRAINT app_sessions_aal_check CHECK (aal IN ('aal1', 'aal2'));

CREATE INDEX IF NOT EXISTS app_sessions_user_active_idx
  ON app_sessions(user_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS app_sessions_aal2_idx
  ON app_sessions(user_id, aal, revoked_at, expires_at);

ALTER TABLE app_totp_factors
  ADD COLUMN IF NOT EXISTS digits integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS period integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS algorithm text NOT NULL DEFAULT 'SHA1',
  ADD COLUMN IF NOT EXISTS last_used_step bigint;

ALTER TABLE app_totp_factors
  ADD CONSTRAINT app_totp_factors_digits_check CHECK (digits IN (6, 8)),
  ADD CONSTRAINT app_totp_factors_period_check CHECK (period BETWEEN 15 AND 120),
  ADD CONSTRAINT app_totp_factors_algorithm_check CHECK (algorithm IN ('SHA1', 'SHA256', 'SHA512'));

CREATE INDEX IF NOT EXISTS app_totp_factors_enabled_idx
  ON app_totp_factors(user_id, enabled);
