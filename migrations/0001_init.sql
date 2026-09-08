-- Flash Pag MVP schema. Amounts are integer centavos (BRL minor units), never float.
create extension if not exists pgcrypto with schema extensions;

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active','blocked')),
  created_at timestamptz not null default now()
);

create table public.merchant_users (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (merchant_id, user_id)
);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin','super_admin')),
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','blocked')),
  created_at timestamptz not null default now()
);
create index organizations_merchant_id_idx on public.organizations(merchant_id);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null default 'Principal',
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'active' check (status in ('active','blocked','closed')),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index accounts_one_default_per_org_idx on public.accounts(organization_id) where is_default;
create index accounts_organization_id_idx on public.accounts(organization_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_id text,
  name text,
  email text,
  document text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_id)
);
create index customers_organization_created_idx on public.customers(organization_id, created_at desc);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  prefix text not null,
  secret_hash text not null unique,
  scopes text[] not null default array['pix:read','pix:write','balance:read','customers:read','customers:write','webhooks:write'],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_keys_org_idx on public.api_keys(organization_id);

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_code text not null,
  label text not null,
  credentials_ciphertext text,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','disabled','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider_code, label)
);
create index provider_connections_org_idx on public.provider_connections(organization_id);

create table public.transactions (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  provider_connection_id uuid references public.provider_connections(id) on delete set null,
  provider_code text not null,
  provider_external_id text,
  kind text not null check (kind in ('pix_in','transfer','withdrawal')),
  direction text not null check (direction in ('in','out')),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','ambiguous')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  description text,
  pix_key text,
  qr_code text,
  provider_payload jsonb,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index transactions_org_created_idx on public.transactions(organization_id, created_at desc);
create index transactions_account_created_idx on public.transactions(account_id, created_at desc);
create unique index transactions_provider_connection_external_idx on public.transactions(provider_connection_id, provider_external_id) where provider_connection_id is not null and provider_external_id is not null;
create unique index transactions_provider_external_without_connection_idx on public.transactions(provider_code, provider_external_id) where provider_connection_id is null and provider_external_id is not null;

create table public.transaction_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index transaction_events_tx_idx on public.transaction_events(transaction_id, created_at);

create table public.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider_connection_id uuid not null references public.provider_connections(id) on delete restrict,
  provider_event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider_connection_id, provider_event_id)
);

create table public.ledger_journals (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references public.transactions(id) on delete restrict,
  kind text not null,
  currency text not null default 'BRL' check (currency = 'BRL'),
  reversal_of uuid references public.ledger_journals(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.ledger_journals(id) on delete restrict,
  account_id uuid references public.accounts(id) on delete restrict,
  bucket text not null check (bucket in ('available','reserved','clearing')),
  amount_minor bigint not null check (amount_minor <> 0),
  created_at timestamptz not null default now(),
  check ((account_id is not null and bucket in ('available','reserved')) or (account_id is null and bucket = 'clearing'))
);
create index ledger_entries_account_bucket_idx on public.ledger_entries(account_id, bucket);
create index ledger_entries_journal_idx on public.ledger_entries(journal_id);

create table public.api_idempotency_keys (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  fingerprint text not null,
  resource_id uuid not null,
  status text not null default 'processing' check (status in ('processing','succeeded','failed_final','ambiguous')),
  response_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  primary key (organization_id, operation, idempotency_key)
);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  url text not null,
  description text,
  events text[] not null default array['transaction.*'],
  secret_ciphertext text not null,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now()
);
create index webhook_endpoints_org_idx on public.webhook_endpoints(organization_id);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivering','succeeded','failed')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status integer,
  last_error text,
  locked_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique(endpoint_id, event_id)
);
create index webhook_deliveries_due_idx on public.webhook_deliveries(status, next_attempt_at) where status in ('pending','failed');

-- All application data stays server-side. The browser never talks to these tables directly.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on public.%I from anon, authenticated', r.tablename);
  end loop;
end $$;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace function public.reject_ledger_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'ledger history is immutable; post a reversal journal instead';
end $$;
create trigger ledger_entries_immutable before update or delete on public.ledger_entries for each row execute function public.reject_ledger_mutation();
create trigger ledger_journals_immutable before update or delete on public.ledger_journals for each row execute function public.reject_ledger_mutation();

create or replace function public.assert_journal_balanced()
returns trigger language plpgsql as $$
declare j uuid; total bigint;
begin
  j := coalesce(new.journal_id, old.journal_id);
  select coalesce(sum(amount_minor),0) into total from public.ledger_entries where journal_id=j;
  if total <> 0 then raise exception 'unbalanced journal %, residual %', j, total; end if;
  return null;
end $$;
create constraint trigger ledger_entries_balanced
  after insert or update or delete on public.ledger_entries
  deferrable initially deferred for each row execute function public.assert_journal_balanced();

create or replace function public.account_balance(p_organization_id uuid, p_account_id uuid)
returns jsonb language plpgsql as $$
declare a bigint; r bigint;
begin
  perform 1 from public.accounts where id=p_account_id and organization_id=p_organization_id;
  if not found then raise exception 'account not found'; end if;
  select coalesce(sum(amount_minor),0) into a from public.ledger_entries where account_id=p_account_id and bucket='available';
  select coalesce(sum(amount_minor),0) into r from public.ledger_entries where account_id=p_account_id and bucket='reserved';
  return jsonb_build_object('account_id',p_account_id,'currency','BRL','available_minor',a,'reserved_minor',r,'total_minor',a+r);
end $$;

create or replace function public.claim_idempotency(
  p_organization_id uuid, p_operation text, p_key text, p_fingerprint text, p_resource_id uuid
) returns jsonb language plpgsql as $$
declare row public.api_idempotency_keys%rowtype; inserted_count integer := 0;
begin
  insert into public.api_idempotency_keys(organization_id,operation,idempotency_key,fingerprint,resource_id)
  values(p_organization_id,p_operation,p_key,p_fingerprint,p_resource_id)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  select * into row from public.api_idempotency_keys
   where organization_id=p_organization_id and operation=p_operation and idempotency_key=p_key;
  if row.fingerprint <> p_fingerprint then return jsonb_build_object('action','conflict'); end if;
  if inserted_count = 1 then return jsonb_build_object('action','acquired','resource_id',row.resource_id); end if;
  if row.status in ('succeeded','failed_final') then return jsonb_build_object('action','replay','resource_id',row.resource_id,'status',row.status,'response',row.response_json); end if;
  return jsonb_build_object('action',row.status,'resource_id',row.resource_id);
end $$;

create or replace function public.finish_idempotency(
  p_organization_id uuid, p_operation text, p_key text, p_status text, p_response jsonb
) returns void language plpgsql as $$
begin
  if p_status not in ('succeeded','failed_final','ambiguous') then raise exception 'invalid idempotency status'; end if;
  update public.api_idempotency_keys set status=p_status,response_json=p_response,updated_at=now()
   where organization_id=p_organization_id and operation=p_operation and idempotency_key=p_key;
end $$;

create or replace function public.begin_pix_in(
  p_transaction_id uuid, p_organization_id uuid, p_account_id uuid, p_customer_id uuid,
  p_amount_minor bigint, p_currency text, p_description text, p_provider_code text, p_provider_connection_id uuid
) returns uuid language plpgsql as $$
begin
  if p_amount_minor <= 0 or p_currency <> 'BRL' then raise exception 'invalid amount/currency'; end if;
  perform 1 from public.accounts where id=p_account_id and organization_id=p_organization_id and status='active';
  if not found then raise exception 'active account not found'; end if;
  insert into public.transactions(id,organization_id,account_id,customer_id,provider_connection_id,provider_code,kind,direction,status,amount_minor,currency,description)
  values(p_transaction_id,p_organization_id,p_account_id,p_customer_id,p_provider_connection_id,p_provider_code,'pix_in','in','pending',p_amount_minor,p_currency,p_description);
  insert into public.transaction_events(transaction_id,event_type,payload) values(p_transaction_id,'transaction.created',jsonb_build_object('status','pending'));
  return p_transaction_id;
end $$;

create or replace function public.begin_outbound(
  p_transaction_id uuid, p_organization_id uuid, p_account_id uuid, p_kind text,
  p_amount_minor bigint, p_currency text, p_description text, p_pix_key text,
  p_provider_code text, p_provider_connection_id uuid
) returns uuid language plpgsql as $$
declare available bigint; j uuid;
begin
  if p_kind not in ('transfer','withdrawal') then raise exception 'invalid outbound kind'; end if;
  if p_amount_minor <= 0 or p_currency <> 'BRL' or coalesce(p_pix_key,'')='' then raise exception 'invalid outbound request'; end if;
  perform 1 from public.accounts where id=p_account_id and organization_id=p_organization_id and status='active' for update;
  if not found then raise exception 'active account not found'; end if;
  select coalesce(sum(amount_minor),0) into available from public.ledger_entries where account_id=p_account_id and bucket='available';
  if available < p_amount_minor then raise exception 'insufficient_available_balance'; end if;
  insert into public.transactions(id,organization_id,account_id,provider_connection_id,provider_code,kind,direction,status,amount_minor,currency,description,pix_key)
  values(p_transaction_id,p_organization_id,p_account_id,p_provider_connection_id,p_provider_code,p_kind,'out','pending',p_amount_minor,p_currency,p_description,p_pix_key);
  insert into public.ledger_journals(transaction_id,kind,currency) values(p_transaction_id,'reserve_outbound',p_currency) returning id into j;
  insert into public.ledger_entries(journal_id,account_id,bucket,amount_minor) values
    (j,p_account_id,'available',-p_amount_minor),(j,p_account_id,'reserved',p_amount_minor);
  insert into public.transaction_events(transaction_id,event_type,payload) values(p_transaction_id,'transaction.created',jsonb_build_object('status','pending'));
  return p_transaction_id;
end $$;

create or replace function public.settle_pix_in(p_transaction_id uuid)
returns void language plpgsql as $$
declare t public.transactions%rowtype; j uuid;
begin
  select * into t from public.transactions where id=p_transaction_id for update;
  if not found then raise exception 'transaction not found'; end if;
  if t.kind <> 'pix_in' then raise exception 'not pix_in'; end if;
  if t.status='succeeded' then return; end if;
  if t.status='failed' then raise exception 'illegal transition failed->succeeded'; end if;
  insert into public.ledger_journals(transaction_id,kind,currency) values(t.id,'settle_pix_in',t.currency) returning id into j;
  insert into public.ledger_entries(journal_id,account_id,bucket,amount_minor) values
    (j,t.account_id,'available',t.amount_minor),(j,null,'clearing',-t.amount_minor);
  update public.transactions set status='succeeded',completed_at=now(),updated_at=now() where id=t.id;
  insert into public.transaction_events(transaction_id,event_type,payload) values(t.id,'transaction.succeeded',jsonb_build_object('amount_minor',t.amount_minor));
end $$;

create or replace function public.complete_outbound(p_transaction_id uuid)
returns void language plpgsql as $$
declare t public.transactions%rowtype; j uuid;
begin
  select * into t from public.transactions where id=p_transaction_id for update;
  if not found then raise exception 'transaction not found'; end if;
  if t.kind not in ('transfer','withdrawal') then raise exception 'not outbound'; end if;
  if t.status='succeeded' then return; end if;
  if t.status='failed' then raise exception 'illegal transition failed->succeeded'; end if;
  insert into public.ledger_journals(transaction_id,kind,currency) values(t.id,'complete_outbound',t.currency) returning id into j;
  insert into public.ledger_entries(journal_id,account_id,bucket,amount_minor) values
    (j,t.account_id,'reserved',-t.amount_minor),(j,null,'clearing',t.amount_minor);
  update public.transactions set status='succeeded',completed_at=now(),updated_at=now() where id=t.id;
  insert into public.transaction_events(transaction_id,event_type,payload) values(t.id,'transaction.succeeded',jsonb_build_object('amount_minor',t.amount_minor));
end $$;

create or replace function public.fail_outbound(p_transaction_id uuid, p_code text, p_message text)
returns void language plpgsql as $$
declare t public.transactions%rowtype; j uuid;
begin
  select * into t from public.transactions where id=p_transaction_id for update;
  if not found then raise exception 'transaction not found'; end if;
  if t.kind not in ('transfer','withdrawal') then raise exception 'not outbound'; end if;
  if t.status='failed' then return; end if;
  if t.status='succeeded' then raise exception 'illegal transition succeeded->failed'; end if;
  insert into public.ledger_journals(transaction_id,kind,currency) values(t.id,'release_outbound',t.currency) returning id into j;
  insert into public.ledger_entries(journal_id,account_id,bucket,amount_minor) values
    (j,t.account_id,'reserved',-t.amount_minor),(j,t.account_id,'available',t.amount_minor);
  update public.transactions set status='failed',failure_code=p_code,failure_message=p_message,completed_at=now(),updated_at=now() where id=t.id;
  insert into public.transaction_events(transaction_id,event_type,payload) values(t.id,'transaction.failed',jsonb_build_object('code',p_code));
end $$;

create or replace function public.enqueue_webhook_event(p_organization_id uuid, p_event_type text, p_payload jsonb)
returns uuid language plpgsql as $$
declare eid uuid := gen_random_uuid();
begin
  insert into public.webhook_deliveries(endpoint_id,organization_id,event_id,event_type,payload)
  select id,p_organization_id,eid,p_event_type,p_payload from public.webhook_endpoints
  where organization_id=p_organization_id and status='active'
    and (events @> array[p_event_type] or events @> array['transaction.*']);
  return eid;
end $$;

create or replace function public.claim_webhook_deliveries(p_limit integer default 20)
returns setof public.webhook_deliveries language plpgsql as $$
begin
  return query
  with claimed as (
    select id from public.webhook_deliveries
    where ((status in ('pending','failed') and next_attempt_at <= now())
        or (status='delivering' and locked_at < now() - interval '5 minutes'))
      and attempt_count < 8
    order by next_attempt_at, created_at
    for update skip locked limit greatest(1,least(p_limit,100))
  ), upd as (
    update public.webhook_deliveries d set status='delivering',locked_at=now(),attempt_count=d.attempt_count+1
    from claimed where d.id=claimed.id returning d.*
  ) select * from upd;
end $$;

revoke execute on function public.account_balance(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.claim_idempotency(uuid,text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.finish_idempotency(uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.begin_pix_in(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.begin_outbound(uuid,uuid,uuid,text,bigint,text,text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.settle_pix_in(uuid) from public, anon, authenticated;
revoke execute on function public.complete_outbound(uuid) from public, anon, authenticated;
revoke execute on function public.fail_outbound(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.enqueue_webhook_event(uuid,text,jsonb) from public, anon, authenticated;
revoke execute on function public.claim_webhook_deliveries(integer) from public, anon, authenticated;

grant execute on function public.account_balance(uuid,uuid) to service_role;
grant execute on function public.claim_idempotency(uuid,text,text,text,uuid) to service_role;
grant execute on function public.finish_idempotency(uuid,text,text,text,jsonb) to service_role;
grant execute on function public.begin_pix_in(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid) to service_role;
grant execute on function public.begin_outbound(uuid,uuid,uuid,text,bigint,text,text,text,text,uuid) to service_role;
grant execute on function public.settle_pix_in(uuid) to service_role;
grant execute on function public.complete_outbound(uuid) to service_role;
grant execute on function public.fail_outbound(uuid,text,text) to service_role;
grant execute on function public.enqueue_webhook_event(uuid,text,jsonb) to service_role;
grant execute on function public.claim_webhook_deliveries(integer) to service_role;
