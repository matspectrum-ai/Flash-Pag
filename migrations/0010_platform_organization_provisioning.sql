-- Atomic platform-admin provisioning for an Organization/commercial account.
-- Merchant remains the internal commercial boundary; the operator provisions one Organization.

create or replace function public.provision_platform_organization(
  p_name text,
  p_slug text,
  p_owner_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.merchants%rowtype;
  o public.organizations%rowtype;
  a public.accounts%rowtype;
begin
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_slug), '') = '' then
    raise exception 'name and slug are required';
  end if;

  if exists (
    select 1
      from public.organizations
     where slug = lower(trim(p_slug))
  ) then
    raise exception 'organization slug already exists';
  end if;

  insert into public.merchants(name)
  values (trim(p_name))
  returning * into m;

  if p_owner_user_id is not null then
    insert into public.merchant_users(merchant_id, user_id, role)
    values (m.id, p_owner_user_id, 'owner');
  end if;

  insert into public.organizations(merchant_id, name, slug)
  values (m.id, trim(p_name), lower(trim(p_slug)))
  returning * into o;

  insert into public.accounts(organization_id, name, currency, status, is_default)
  values (o.id, 'Principal', 'BRL', 'active', true)
  returning * into a;

  return jsonb_build_object(
    'organization', to_jsonb(o),
    'account', to_jsonb(a)
  );
end;
$$;

revoke all on function public.provision_platform_organization(text,text,uuid) from public, anon, authenticated;
grant execute on function public.provision_platform_organization(text,text,uuid) to service_role;
