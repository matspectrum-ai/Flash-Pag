-- Legacy recovery-era MFA helper. The application now uses the Supabase Auth Admin
-- API for factor removal; keeping this function would leave an unnecessary
-- SECURITY DEFINER path into auth.mfa_factors.
drop function if exists public.flashpag_reset_user_mfa(uuid);
