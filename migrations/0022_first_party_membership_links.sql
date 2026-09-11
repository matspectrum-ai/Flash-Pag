-- First-party authorization bridge.
-- This migration keeps the legacy auth.users foreign keys intact while introducing
-- durable app_users references for the staged identity cutover.

ALTER TABLE public.merchant_users
  ADD COLUMN IF NOT EXISTS app_user_id uuid REFERENCES public.app_users(id) ON DELETE CASCADE;

ALTER TABLE public.platform_admins
  ADD COLUMN IF NOT EXISTS app_user_id uuid REFERENCES public.app_users(id) ON DELETE CASCADE;

UPDATE public.merchant_users mu
SET app_user_id = au.id
FROM public.app_users au
WHERE mu.user_id = au.legacy_auth_user_id
  AND mu.app_user_id IS NULL;

UPDATE public.platform_admins pa
SET app_user_id = au.id
FROM public.app_users au
WHERE pa.user_id = au.legacy_auth_user_id
  AND pa.app_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS merchant_users_app_user_unique_idx
  ON public.merchant_users(merchant_id, app_user_id)
  WHERE app_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS platform_admins_app_user_unique_idx
  ON public.platform_admins(app_user_id)
  WHERE app_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS merchant_users_app_user_idx
  ON public.merchant_users(app_user_id)
  WHERE app_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS platform_admins_app_user_idx
  ON public.platform_admins(app_user_id)
  WHERE app_user_id IS NOT NULL;

COMMENT ON COLUMN public.merchant_users.app_user_id IS
  'First-party Flash Pag identity bridge. Legacy user_id remains authoritative until staged cutover is validated.';
COMMENT ON COLUMN public.platform_admins.app_user_id IS
  'First-party Flash Pag identity bridge. Legacy user_id remains authoritative until staged cutover is validated.';

CREATE OR REPLACE FUNCTION public.merchant_members_for_organization_first_party(p_organization_id uuid)
RETURNS TABLE (
  user_id uuid,
  username text,
  legacy_user_id uuid,
  legacy_email text,
  role text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    au.id AS user_id,
    au.username,
    mu.user_id AS legacy_user_id,
    au.legacy_email,
    mu.role,
    mu.created_at
  FROM public.organizations o
  JOIN public.merchant_users mu ON mu.merchant_id = o.merchant_id
  JOIN public.app_users au ON au.id = mu.app_user_id
  WHERE o.id = p_organization_id
  ORDER BY
    CASE mu.role
      WHEN 'owner' THEN 0
      WHEN 'admin' THEN 1
      WHEN 'member' THEN 2
      WHEN 'viewer' THEN 3
      ELSE 4
    END,
    lower(au.username),
    mu.created_at;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_for_first_party_user(p_user_id uuid)
RETURNS TABLE (
  user_id uuid,
  role text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pa.app_user_id, pa.role
  FROM public.platform_admins pa
  WHERE pa.app_user_id = p_user_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.merchant_members_for_organization_first_party(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_for_first_party_user(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_members_for_organization_first_party(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_for_first_party_user(uuid) TO service_role;
