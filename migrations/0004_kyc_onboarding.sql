-- Merchant onboarding and KYC/KYB lifecycle.
-- Existing merchants are grandfathered as approved to preserve the running beta.

create table public.merchant_kyc_profiles (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','submitted','under_review','needs_changes','approved','rejected')),
  legal_name text,
  trade_name text,
  tax_id text,
  incorporation_date date,
  company_email text,
  company_phone text,
  address_line1 text,
  address_line2 text,
  district text,
  city text,
  state text,
  postal_code text,
  country text not null default 'BR',
  representative_name text,
  representative_document text,
  representative_birth_date date,
  representative_role text,
  representative_email text,
  representative_phone text,
  public_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz
);
create index merchant_kyc_profiles_status_idx on public.merchant_kyc_profiles(status, updated_at desc);

create table public.merchant_kyc_documents (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  document_type text not null check (document_type in ('articles_of_association','cnpj_card','representative_id','address_proof','ownership_document','bank_proof','other')),
  original_name text not null,
  storage_bucket text not null default 'merchant-kyc',
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  sha256 text not null,
  status text not null default 'pending' check (status in ('pending','accepted','needs_changes','rejected')),
  admin_feedback text,
  uploaded_by uuid references auth.users(id) on delete set null,
  version integer not null default 1 check (version > 0),
  is_current boolean not null default true,
  uploaded_at timestamptz not null default now(),
  replaced_at timestamptz
);
create index merchant_kyc_documents_merchant_idx on public.merchant_kyc_documents(merchant_id, uploaded_at desc);
create unique index merchant_kyc_documents_current_type_idx
  on public.merchant_kyc_documents(merchant_id, document_type)
  where is_current;

create table public.merchant_kyc_reviews (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  reviewer_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('started','needs_changes','approved','rejected')),
  public_note text,
  internal_note text,
  created_at timestamptz not null default now()
);
create index merchant_kyc_reviews_merchant_idx on public.merchant_kyc_reviews(merchant_id, created_at desc);

create table public.merchant_kyc_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index merchant_kyc_events_merchant_idx on public.merchant_kyc_events(merchant_id, created_at desc);

alter table public.merchant_kyc_profiles enable row level security;
alter table public.merchant_kyc_documents enable row level security;
alter table public.merchant_kyc_reviews enable row level security;
alter table public.merchant_kyc_events enable row level security;
revoke all on public.merchant_kyc_profiles, public.merchant_kyc_documents, public.merchant_kyc_reviews, public.merchant_kyc_events from anon, authenticated;
grant all on public.merchant_kyc_profiles, public.merchant_kyc_documents, public.merchant_kyc_reviews, public.merchant_kyc_events to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('merchant-kyc', 'merchant-kyc', false, 15728640, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Grandfather merchants that already existed before KYC was introduced.
insert into public.merchant_kyc_profiles(merchant_id, status, public_note, approved_at, reviewed_at)
select id, 'approved', 'Conta existente aprovada durante a migração inicial de KYC.', now(), now()
from public.merchants
on conflict (merchant_id) do nothing;

insert into public.merchant_kyc_events(merchant_id, event_type, from_status, to_status, metadata)
select p.merchant_id, 'kyc.legacy_approved', null, 'approved', jsonb_build_object('source','migration_0004')
from public.merchant_kyc_profiles p
where p.status = 'approved'
  and not exists (
    select 1 from public.merchant_kyc_events e
    where e.merchant_id = p.merchant_id and e.event_type = 'kyc.legacy_approved'
  );

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
  if exists(select 1 from public.merchant_users where user_id = p_user_id) then
    raise exception 'user already belongs to a merchant';
  end if;
  if exists(select 1 from public.organizations where slug = lower(trim(p_organization_slug))) then
    raise exception 'organization slug already exists';
  end if;

  insert into public.merchants(name) values(trim(p_merchant_name)) returning * into m;
  insert into public.merchant_users(merchant_id,user_id,role) values(m.id,p_user_id,'owner');
  insert into public.organizations(merchant_id,name,slug)
    values(m.id,coalesce(nullif(trim(p_organization_name),''),trim(p_merchant_name)),lower(trim(p_organization_slug))) returning * into o;
  insert into public.accounts(organization_id,name,currency,status,is_default)
    values(o.id,'Principal','BRL','active',true) returning * into a;
  insert into public.merchant_kyc_profiles(merchant_id,status) values(m.id,'draft');
  insert into public.merchant_kyc_events(merchant_id,actor_user_id,event_type,to_status)
    values(m.id,p_user_id,'kyc.created','draft');

  return jsonb_build_object('merchant',to_jsonb(m),'organization',to_jsonb(o),'account',to_jsonb(a));
end;
$$;

create or replace function public.register_merchant_kyc_document(
  p_id uuid,
  p_merchant_id uuid,
  p_document_type text,
  p_original_name text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_uploaded_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
  row public.merchant_kyc_documents%rowtype;
begin
  if p_document_type not in ('articles_of_association','cnpj_card','representative_id','address_proof','ownership_document','bank_proof','other') then
    raise exception 'invalid document type';
  end if;
  select coalesce(max(version),0)+1 into next_version
    from public.merchant_kyc_documents
   where merchant_id=p_merchant_id and document_type=p_document_type;
  update public.merchant_kyc_documents
     set is_current=false,replaced_at=now()
   where merchant_id=p_merchant_id and document_type=p_document_type and is_current;
  insert into public.merchant_kyc_documents(
    id,merchant_id,document_type,original_name,storage_path,mime_type,size_bytes,sha256,uploaded_by,version,is_current
  ) values(
    p_id,p_merchant_id,p_document_type,p_original_name,p_storage_path,p_mime_type,p_size_bytes,p_sha256,p_uploaded_by,next_version,true
  ) returning * into row;
  insert into public.merchant_kyc_events(merchant_id,actor_user_id,event_type,metadata)
    values(p_merchant_id,p_uploaded_by,'kyc.document_uploaded',jsonb_build_object('document_id',p_id,'document_type',p_document_type,'version',next_version));
  return to_jsonb(row);
end;
$$;

create or replace function public.submit_merchant_kyc(p_merchant_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  old_status text;
  row public.merchant_kyc_profiles%rowtype;
begin
  select status into old_status from public.merchant_kyc_profiles where merchant_id=p_merchant_id for update;
  if old_status not in ('draft','needs_changes','rejected') then
    raise exception 'kyc cannot be submitted from status %', old_status;
  end if;
  update public.merchant_kyc_profiles set
    status='submitted', public_note=null, submitted_at=now(), reviewed_at=null, rejected_at=null, updated_at=now()
  where merchant_id=p_merchant_id returning * into row;
  update public.merchant_kyc_documents set status='pending',admin_feedback=null
    where merchant_id=p_merchant_id and is_current;
  insert into public.merchant_kyc_events(merchant_id,actor_user_id,event_type,from_status,to_status)
    values(p_merchant_id,p_actor_user_id,'kyc.submitted',old_status,'submitted');
  return to_jsonb(row);
end;
$$;

create or replace function public.start_merchant_kyc_review(p_merchant_id uuid, p_reviewer_user_id uuid, p_internal_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  old_status text;
  row public.merchant_kyc_profiles%rowtype;
begin
  select status into old_status from public.merchant_kyc_profiles where merchant_id=p_merchant_id for update;
  if old_status not in ('submitted','under_review') then
    raise exception 'kyc cannot enter review from status %', old_status;
  end if;
  update public.merchant_kyc_profiles set status='under_review',reviewed_at=now(),updated_at=now()
    where merchant_id=p_merchant_id returning * into row;
  insert into public.merchant_kyc_reviews(merchant_id,reviewer_user_id,action,internal_note)
    values(p_merchant_id,p_reviewer_user_id,'started',nullif(trim(p_internal_note),''));
  insert into public.merchant_kyc_events(merchant_id,actor_user_id,event_type,from_status,to_status)
    values(p_merchant_id,p_reviewer_user_id,'kyc.review_started',old_status,'under_review');
  return to_jsonb(row);
end;
$$;

create or replace function public.decide_merchant_kyc(
  p_merchant_id uuid,
  p_reviewer_user_id uuid,
  p_decision text,
  p_public_note text default null,
  p_internal_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  old_status text;
  row public.merchant_kyc_profiles%rowtype;
begin
  if p_decision not in ('approved','needs_changes','rejected') then
    raise exception 'invalid kyc decision';
  end if;
  if p_decision in ('needs_changes','rejected') and coalesce(trim(p_public_note),'') = '' then
    raise exception 'public note is required for this decision';
  end if;
  select status into old_status from public.merchant_kyc_profiles where merchant_id=p_merchant_id for update;
  if old_status not in ('submitted','under_review') then
    raise exception 'kyc cannot be decided from status %', old_status;
  end if;

  update public.merchant_kyc_profiles set
    status=p_decision,
    public_note=nullif(trim(p_public_note),''),
    reviewed_at=now(),
    approved_at=case when p_decision='approved' then now() else null end,
    rejected_at=case when p_decision='rejected' then now() else null end,
    updated_at=now()
  where merchant_id=p_merchant_id returning * into row;

  update public.merchant_kyc_documents set
    status=case when p_decision='approved' then 'accepted' else status end
  where merchant_id=p_merchant_id and is_current;

  insert into public.merchant_kyc_reviews(merchant_id,reviewer_user_id,action,public_note,internal_note)
    values(p_merchant_id,p_reviewer_user_id,p_decision,nullif(trim(p_public_note),''),nullif(trim(p_internal_note),''));
  insert into public.merchant_kyc_events(merchant_id,actor_user_id,event_type,from_status,to_status)
    values(p_merchant_id,p_reviewer_user_id,'kyc.'||p_decision,old_status,p_decision);
  return to_jsonb(row);
end;
$$;

create or replace function public.platform_kyc_queue()
returns table(
  merchant_id uuid,
  merchant_name text,
  merchant_status text,
  kyc_status text,
  tax_id text,
  legal_name text,
  company_email text,
  submitted_at timestamptz,
  updated_at timestamptz,
  document_count bigint
)
language sql
security definer
set search_path = public
as $$
  select m.id,m.name,m.status,p.status,p.tax_id,p.legal_name,p.company_email,p.submitted_at,p.updated_at,
    (select count(*) from public.merchant_kyc_documents d where d.merchant_id=m.id and d.is_current)
  from public.merchants m
  left join public.merchant_kyc_profiles p on p.merchant_id=m.id
  order by coalesce(p.updated_at,m.created_at) desc;
$$;

create or replace function public.kyc_reviews_with_email(p_merchant_id uuid)
returns table(id uuid, reviewer_user_id uuid, reviewer_email text, action text, public_note text, internal_note text, created_at timestamptz)
language sql
security definer
set search_path = public, auth
as $$
  select r.id,r.reviewer_user_id,u.email::text,r.action,r.public_note,r.internal_note,r.created_at
    from public.merchant_kyc_reviews r
    left join auth.users u on u.id=r.reviewer_user_id
   where r.merchant_id=p_merchant_id
   order by r.created_at desc;
$$;

revoke all on function public.provision_merchant_for_user(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.register_merchant_kyc_document(uuid,uuid,text,text,text,text,bigint,text,uuid) from public, anon, authenticated;
revoke all on function public.submit_merchant_kyc(uuid,uuid) from public, anon, authenticated;
revoke all on function public.start_merchant_kyc_review(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.decide_merchant_kyc(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.platform_kyc_queue() from public, anon, authenticated;
revoke all on function public.kyc_reviews_with_email(uuid) from public, anon, authenticated;
grant execute on function public.provision_merchant_for_user(uuid,text,text,text) to service_role;
grant execute on function public.register_merchant_kyc_document(uuid,uuid,text,text,text,text,bigint,text,uuid) to service_role;
grant execute on function public.submit_merchant_kyc(uuid,uuid) to service_role;
grant execute on function public.start_merchant_kyc_review(uuid,uuid,text) to service_role;
grant execute on function public.decide_merchant_kyc(uuid,uuid,text,text,text) to service_role;
grant execute on function public.platform_kyc_queue() to service_role;
grant execute on function public.kyc_reviews_with_email(uuid) to service_role;
