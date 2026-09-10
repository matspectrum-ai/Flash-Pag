-- The diagnostic TOTP RPC is no longer used by the application.
-- It exposed authentication-factor state through a public SECURITY DEFINER path.
revoke all on function public.flashpag_verified_totp_factor() from public, anon, authenticated;
drop function if exists public.flashpag_verified_totp_factor();
