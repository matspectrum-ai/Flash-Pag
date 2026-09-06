-- Merchant member directory helpers for the SaaS console.
-- These functions are service-role only. Browser clients never query auth.users directly.

create or replace function public.merchant_members_for_organization(p_organization_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  created_at timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  select
    mu.user_id,
    coalesce(u.email, '')::text as email,
    mu.role,
    mu.created_at
  from public.organizations o
  join public.merchant_users mu on mu.merchant_id = o.merchant_id
  left join auth.users u on u.id = mu.user_id
  where o.id = p_organization_id
  order by
    case mu.role
      when 'owner' then 0
      when 'admin' then 1
      when 'member' then 2
      when 'viewer' then 3
      else 4
    end,
    lower(coalesce(u.email, '')),
    mu.created_at;
$$;

revoke all on function public.merchant_members_for_organization(uuid) from public, anon, authenticated;
grant execute on function public.merchant_members_for_organization(uuid) to service_role;

create or replace function public.lookup_auth_user_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.lookup_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.lookup_auth_user_by_email(text) to service_role;
