-- Harden KYC onboarding invariants after the initial KYC schema.
-- Every merchant must have exactly one KYC profile, regardless of which application path creates it.

create or replace function public.ensure_merchant_kyc_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.merchant_kyc_profiles(merchant_id, status)
  values (new.id, 'draft')
  on conflict (merchant_id) do nothing;

  insert into public.merchant_kyc_events(merchant_id, event_type, to_status, metadata)
  select new.id, 'kyc.created', 'draft', jsonb_build_object('source', 'merchant_insert_trigger')
  where not exists (
    select 1
      from public.merchant_kyc_events e
     where e.merchant_id = new.id
       and e.event_type = 'kyc.created'
  );

  return new;
end;
$$;

revoke all on function public.ensure_merchant_kyc_profile() from public, anon, authenticated;
grant execute on function public.ensure_merchant_kyc_profile() to service_role;

drop trigger if exists merchants_ensure_kyc_profile on public.merchants;
create trigger merchants_ensure_kyc_profile
after insert on public.merchants
for each row execute function public.ensure_merchant_kyc_profile();

-- Defensive backfill in case a merchant was inserted between the initial KYC migration
-- and this hardening migration.
insert into public.merchant_kyc_profiles(merchant_id, status)
select m.id, 'draft'
  from public.merchants m
  left join public.merchant_kyc_profiles p on p.merchant_id = m.id
 where p.merchant_id is null
on conflict (merchant_id) do nothing;

-- Provisioning is retry-safe. If the network loses the first successful response,
-- a retry returns the already-provisioned merchant instead of creating another tenant
-- or leaving the auth user in an unrecoverable state.
create or replace function public.provision_merchant_for_user(
  p_user_id uuid,
  p_merchant_name text,
  p_organization_name text,
  p_organization_slug text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.merchants%rowtype;
  o public.organizations%rowtype;
  a public.accounts%rowtype;
begin
  if p_user_id is null or coalesce(trim(p_merchant_name),'') = '' or coalesce(trim(p_organization_slug),'') = '' then
    raise exception 'invalid provisioning request';
  end if;

  select mer.*
    into m
    from public.merchant_users mu
    join public.merchants mer on mer.id = mu.merchant_id
   where mu.user_id = p_user_id
   order by mu.created_at asc
   limit 1;

  if found then
    select org.*
      into o
      from public.organizations org
     where org.merchant_id = m.id
     order by org.created_at asc
     limit 1;
    if not found then
      raise exception 'existing merchant provisioning is incomplete: organization missing';
    end if;

    select acct.*
      into a
      from public.accounts acct
     where acct.organization_id = o.id
     order by acct.is_default desc, acct.created_at asc
     limit 1;
    if not found then
      raise exception 'existing merchant provisioning is incomplete: account missing';
    end if;

    return jsonb_build_object('merchant',to_jsonb(m),'organization',to_jsonb(o),'account',to_jsonb(a));
  end if;

  if exists(select 1 from public.organizations where slug = lower(trim(p_organization_slug))) then
    raise exception 'organization slug already exists';
  end if;

  insert into public.merchants(name)
  values(trim(p_merchant_name))
  returning * into m;

  insert into public.merchant_users(merchant_id,user_id,role)
  values(m.id,p_user_id,'owner');

  insert into public.organizations(merchant_id,name,slug)
  values(
    m.id,
    coalesce(nullif(trim(p_organization_name),''),trim(p_merchant_name)),
    lower(trim(p_organization_slug))
  )
  returning * into o;

  insert into public.accounts(organization_id,name,currency,status,is_default)
  values(o.id,'Principal','BRL','active',true)
  returning * into a;

  update public.merchant_kyc_events
     set actor_user_id = p_user_id,
         metadata = metadata || jsonb_build_object('source','self_registration')
   where merchant_id = m.id
     and event_type = 'kyc.created'
     and actor_user_id is null;

  return jsonb_build_object('merchant',to_jsonb(m),'organization',to_jsonb(o),'account',to_jsonb(a));
end;
$$;

revoke all on function public.provision_merchant_for_user(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.provision_merchant_for_user(uuid,text,text,text) to service_role;
