-- Merchant pricing / fee engine.
-- Pricing is versioned per Merchant. Transactions freeze the exact rule and effective fee
-- used when they are created; historical pricing and ledger records are immutable.

create table public.merchant_pricing_versions (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  version integer not null check (version > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (merchant_id, version),
  unique (merchant_id, id)
);
create index merchant_pricing_versions_merchant_idx on public.merchant_pricing_versions(merchant_id, version desc);
create index merchant_pricing_versions_created_by_idx on public.merchant_pricing_versions(created_by) where created_by is not null;

create table public.merchant_pricing_rules (
  pricing_version_id uuid not null,
  merchant_id uuid not null,
  operation text not null check (operation in ('pix_in','transfer','withdrawal')),
  fixed_minor bigint not null default 0 check (fixed_minor >= 0),
  percent_bps integer not null default 0 check (percent_bps between 0 and 10000),
  min_fee_minor bigint check (min_fee_minor is null or min_fee_minor >= 0),
  max_fee_minor bigint check (max_fee_minor is null or max_fee_minor >= 0),
  primary key (pricing_version_id, operation),
  foreign key (merchant_id, pricing_version_id)
    references public.merchant_pricing_versions(merchant_id, id) on delete restrict,
  check (min_fee_minor is null or max_fee_minor is null or min_fee_minor <= max_fee_minor)
);
create index merchant_pricing_rules_merchant_idx on public.merchant_pricing_rules(merchant_id, operation);

create table public.merchant_pricing_current (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  pricing_version_id uuid not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (merchant_id, pricing_version_id)
    references public.merchant_pricing_versions(merchant_id, id) on delete restrict
);
create index merchant_pricing_current_updated_by_idx on public.merchant_pricing_current(updated_by) where updated_by is not null;

alter table public.merchant_pricing_versions enable row level security;
alter table public.merchant_pricing_rules enable row level security;
alter table public.merchant_pricing_current enable row level security;
revoke all on public.merchant_pricing_versions, public.merchant_pricing_rules, public.merchant_pricing_current from anon, authenticated;
grant all on public.merchant_pricing_versions, public.merchant_pricing_rules, public.merchant_pricing_current to service_role;

create or replace function public.reject_pricing_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'pricing history is immutable; create a new pricing version instead';
end;
$$;

create trigger merchant_pricing_versions_immutable
before update or delete on public.merchant_pricing_versions
for each row execute function public.reject_pricing_history_mutation();

create trigger merchant_pricing_rules_immutable
before update or delete on public.merchant_pricing_rules
for each row execute function public.reject_pricing_history_mutation();

create or replace function public.initialize_merchant_pricing(p_merchant_id uuid, p_created_by uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
  version_id uuid;
  next_version integer;
begin
  perform 1 from public.merchants where id = p_merchant_id for update;
  if not found then
    raise exception 'merchant not found';
  end if;

  select pricing_version_id into existing_id
    from public.merchant_pricing_current
   where merchant_id = p_merchant_id;
  if found then
    return existing_id;
  end if;

  select coalesce(max(version), 0) + 1 into next_version
    from public.merchant_pricing_versions
   where merchant_id = p_merchant_id;

  insert into public.merchant_pricing_versions(merchant_id, version, currency, note, created_by)
  values (p_merchant_id, next_version, 'BRL', 'Default zero-fee pricing', p_created_by)
  returning id into version_id;

  insert into public.merchant_pricing_rules(pricing_version_id, merchant_id, operation, fixed_minor, percent_bps)
  values
    (version_id, p_merchant_id, 'pix_in', 0, 0),
    (version_id, p_merchant_id, 'transfer', 0, 0),
    (version_id, p_merchant_id, 'withdrawal', 0, 0);

  insert into public.merchant_pricing_current(merchant_id, pricing_version_id, updated_by)
  values (p_merchant_id, version_id, p_created_by);

  return version_id;
end;
$$;

create or replace function public.ensure_merchant_pricing_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.initialize_merchant_pricing(new.id, null);
  return new;
end;
$$;

create trigger merchants_ensure_pricing
  after insert on public.merchants
  for each row execute function public.ensure_merchant_pricing_on_insert();

-- Existing Merchants receive a zero-fee v1 so the running beta keeps its historical economics.
select public.initialize_merchant_pricing(id, null) from public.merchants;

create or replace function public.merchant_pricing_detail(p_merchant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with versions as (
    select
      v.id,
      v.merchant_id,
      v.version,
      v.currency,
      v.note,
      v.created_by,
      v.created_at,
      coalesce((
        select jsonb_object_agg(
          r.operation,
          jsonb_build_object(
            'fixed_minor', r.fixed_minor,
            'percent_bps', r.percent_bps,
            'min_fee_minor', r.min_fee_minor,
            'max_fee_minor', r.max_fee_minor
          )
          order by r.operation
        )
        from public.merchant_pricing_rules r
        where r.pricing_version_id = v.id
      ), '{}'::jsonb) as rules
    from public.merchant_pricing_versions v
    where v.merchant_id = p_merchant_id
  ), current_pricing as (
    select c.pricing_version_id, c.updated_by, c.updated_at
      from public.merchant_pricing_current c
     where c.merchant_id = p_merchant_id
  )
  select jsonb_build_object(
    'merchant', (
      select jsonb_build_object('id', m.id, 'name', m.name, 'status', m.status, 'created_at', m.created_at)
        from public.merchants m where m.id = p_merchant_id
    ),
    'current', (
      select to_jsonb(v) || jsonb_build_object('updated_by', c.updated_by, 'updated_at', c.updated_at)
        from versions v
        join current_pricing c on c.pricing_version_id = v.id
    ),
    'history', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.version desc) from versions v
    ), '[]'::jsonb)
  );
$$;

create or replace function public.set_merchant_pricing(
  p_merchant_id uuid,
  p_created_by uuid,
  p_rules jsonb,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  op text;
  rule jsonb;
  version_id uuid;
  next_version integer;
  fixed_value bigint;
  bps_value integer;
  min_value bigint;
  max_value bigint;
begin
  perform 1 from public.merchants where id = p_merchant_id for update;
  if not found then
    raise exception 'merchant not found';
  end if;
  if jsonb_typeof(p_rules) <> 'object' then
    raise exception 'rules must be a JSON object';
  end if;
  if (select count(*) from jsonb_object_keys(p_rules)) <> 3 then
    raise exception 'pricing must define exactly pix_in, transfer and withdrawal';
  end if;

  foreach op in array array['pix_in','transfer','withdrawal'] loop
    rule := p_rules -> op;
    if rule is null or jsonb_typeof(rule) <> 'object' then
      raise exception 'missing pricing rule for %', op;
    end if;
    fixed_value := coalesce((rule ->> 'fixed_minor')::bigint, 0);
    bps_value := coalesce((rule ->> 'percent_bps')::integer, 0);
    min_value := case when rule ->> 'min_fee_minor' is null then null else (rule ->> 'min_fee_minor')::bigint end;
    max_value := case when rule ->> 'max_fee_minor' is null then null else (rule ->> 'max_fee_minor')::bigint end;

    if fixed_value < 0 or bps_value < 0 or bps_value > 10000 then
      raise exception 'invalid pricing rule for %', op;
    end if;
    if min_value is not null and min_value < 0 then
      raise exception 'invalid minimum fee for %', op;
    end if;
    if max_value is not null and max_value < 0 then
      raise exception 'invalid maximum fee for %', op;
    end if;
    if min_value is not null and max_value is not null and min_value > max_value then
      raise exception 'minimum fee exceeds maximum fee for %', op;
    end if;
  end loop;

  select coalesce(max(version), 0) + 1 into next_version
    from public.merchant_pricing_versions
   where merchant_id = p_merchant_id;

  insert into public.merchant_pricing_versions(merchant_id, version, currency, note, created_by)
  values (p_merchant_id, next_version, 'BRL', nullif(trim(p_note), ''), p_created_by)
  returning id into version_id;

  foreach op in array array['pix_in','transfer','withdrawal'] loop
    rule := p_rules -> op;
    fixed_value := coalesce((rule ->> 'fixed_minor')::bigint, 0);
    bps_value := coalesce((rule ->> 'percent_bps')::integer, 0);
    min_value := case when rule ->> 'min_fee_minor' is null then null else (rule ->> 'min_fee_minor')::bigint end;
    max_value := case when rule ->> 'max_fee_minor' is null then null else (rule ->> 'max_fee_minor')::bigint end;

    insert into public.merchant_pricing_rules(
      pricing_version_id, merchant_id, operation, fixed_minor, percent_bps, min_fee_minor, max_fee_minor
    ) values (
      version_id, p_merchant_id, op, fixed_value, bps_value, min_value, max_value
    );
  end loop;

  insert into public.merchant_pricing_current(merchant_id, pricing_version_id, updated_by, updated_at)
  values (p_merchant_id, version_id, p_created_by, now())
  on conflict (merchant_id) do update set
    pricing_version_id = excluded.pricing_version_id,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  return public.merchant_pricing_detail(p_merchant_id);
end;
$$;

create or replace function public.quote_merchant_pricing(
  p_organization_id uuid,
  p_operation text,
  p_amount_minor bigint
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  version_id uuid;
  version_number integer;
  fixed_value bigint;
  bps_value integer;
  min_value bigint;
  max_value bigint;
  fee_value bigint;
begin
  if p_operation not in ('pix_in','transfer','withdrawal') then
    raise exception 'invalid pricing operation';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'invalid pricing amount';
  end if;

  select
    v.id, v.version,
    r.fixed_minor, r.percent_bps, r.min_fee_minor, r.max_fee_minor
  into
    version_id, version_number,
    fixed_value, bps_value, min_value, max_value
  from public.organizations o
  join public.merchant_pricing_current c on c.merchant_id = o.merchant_id
  join public.merchant_pricing_versions v on v.id = c.pricing_version_id and v.merchant_id = o.merchant_id
  join public.merchant_pricing_rules r on r.pricing_version_id = v.id and r.merchant_id = o.merchant_id
  where o.id = p_organization_id and r.operation = p_operation;

  if not found then
    raise exception 'merchant pricing is not configured';
  end if;

  fee_value := fixed_value + round((p_amount_minor::numeric * bps_value::numeric) / 10000)::bigint;
  if min_value is not null then
    fee_value := greatest(fee_value, min_value);
  end if;
  if max_value is not null then
    fee_value := least(fee_value, max_value);
  end if;

  return jsonb_build_object(
    'pricing_version_id', version_id,
    'version', version_number,
    'operation', p_operation,
    'fixed_minor', fixed_value,
    'percent_bps', bps_value,
    'min_fee_minor', min_value,
    'max_fee_minor', max_value,
    'fee_minor', fee_value
  );
end;
$$;

-- Every transaction stores the fee and pricing snapshot used at creation time.
alter table public.transactions add column pricing_version_id uuid;
alter table public.transactions add column pricing_version integer not null default 1 check (pricing_version > 0);
alter table public.transactions add column fee_minor bigint not null default 0 check (fee_minor >= 0);
alter table public.transactions add column pricing_snapshot jsonb not null default '{}'::jsonb;

update public.transactions t
set
  pricing_version_id = c.pricing_version_id,
  pricing_version = v.version,
  fee_minor = 0,
  pricing_snapshot = jsonb_build_object(
    'pricing_version_id', c.pricing_version_id,
    'version', v.version,
    'operation', t.kind,
    'fixed_minor', 0,
    'percent_bps', 0,
    'min_fee_minor', null,
    'max_fee_minor', null,
    'fee_minor', 0,
    'source', 'legacy_zero_fee'
  )
from public.organizations o
join public.merchant_pricing_current c on c.merchant_id = o.merchant_id
join public.merchant_pricing_versions v on v.id = c.pricing_version_id
where t.organization_id = o.id;

alter table public.transactions alter column pricing_version_id set not null;
alter table public.transactions
  add constraint transactions_pricing_version_fkey
  foreign key (pricing_version_id) references public.merchant_pricing_versions(id) on delete restrict;
create index transactions_pricing_version_idx on public.transactions(pricing_version_id);

create or replace function public.reject_transaction_pricing_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pricing_version_id is distinct from old.pricing_version_id
     or new.pricing_version is distinct from old.pricing_version
     or new.fee_minor is distinct from old.fee_minor
     or new.pricing_snapshot is distinct from old.pricing_snapshot then
    raise exception 'transaction pricing snapshot is immutable';
  end if;
  return new;
end;
$$;

create trigger transactions_pricing_immutable
before update on public.transactions
for each row execute function public.reject_transaction_pricing_mutation();

-- Platform revenue is separate from provider clearing and from merchant balances.
alter table public.ledger_entries drop constraint ledger_entries_bucket_check;
alter table public.ledger_entries drop constraint ledger_entries_check;
alter table public.ledger_entries
  add constraint ledger_entries_bucket_check
  check (bucket in ('available','reserved','clearing','platform_revenue'));
alter table public.ledger_entries
  add constraint ledger_entries_check
  check (
    (account_id is not null and bucket in ('available','reserved'))
    or (account_id is null and bucket in ('clearing','platform_revenue'))
  );

create or replace function public.begin_pix_in(
  p_transaction_id uuid, p_organization_id uuid, p_account_id uuid, p_customer_id uuid,
  p_amount_minor bigint, p_currency text, p_description text, p_provider_code text, p_provider_connection_id uuid
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  pricing jsonb;
  fee_value bigint;
begin
  if p_amount_minor <= 0 or p_currency <> 'BRL' then raise exception 'invalid amount/currency'; end if;
  perform 1 from public.accounts where id=p_account_id and organization_id=p_organization_id and status='active';
  if not found then raise exception 'active account not found'; end if;

  pricing := public.quote_merchant_pricing(p_organization_id, 'pix_in', p_amount_minor);
  fee_value := (pricing ->> 'fee_minor')::bigint;
  if fee_value >= p_amount_minor then
    raise exception 'pricing_fee_exceeds_inbound_amount';
  end if;

  insert into public.transactions(
    id,organization_id,account_id,customer_id,provider_connection_id,provider_code,kind,direction,status,
    amount_minor,currency,description,pricing_version_id,pricing_version,fee_minor,pricing_snapshot
  ) values (
    p_transaction_id,p_organization_id,p_account_id,p_customer_id,p_provider_connection_id,p_provider_code,'pix_in','in','pending',
    p_amount_minor,p_currency,p_description,(pricing ->> 'pricing_version_id')::uuid,(pricing ->> 'version')::integer,fee_value,pricing
  );
  insert into public.transaction_events(transaction_id,event_type,payload)
  values(p_transaction_id,'transaction.created',jsonb_build_object('status','pending','amount_minor',p_amount_minor,'fee_minor',fee_value,'pricing_version',(pricing ->> 'version')::integer));
  return p_transaction_id;
end;
$$;

create or replace function public.begin_outbound(
  p_transaction_id uuid, p_organization_id uuid, p_account_id uuid, p_kind text,
  p_amount_minor bigint, p_currency text, p_description text, p_pix_key text,
  p_provider_code text, p_provider_connection_id uuid
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  available bigint;
  j uuid;
  pricing jsonb;
  fee_value bigint;
  debit_total bigint;
begin
  if p_kind not in ('transfer','withdrawal') then raise exception 'invalid outbound kind'; end if;
  if p_amount_minor <= 0 or p_currency <> 'BRL' or coalesce(p_pix_key,'')='' then raise exception 'invalid outbound request'; end if;
  perform 1 from public.accounts where id=p_account_id and organization_id=p_organization_id and status='active' for update;
  if not found then raise exception 'active account not found'; end if;

  pricing := public.quote_merchant_pricing(p_organization_id, p_kind, p_amount_minor);
  fee_value := (pricing ->> 'fee_minor')::bigint;
  debit_total := p_amount_minor + fee_value;

  select coalesce(sum(amount_minor),0) into available from public.ledger_entries where account_id=p_account_id and bucket='available';
  if available < debit_total then raise exception 'insufficient_available_balance'; end if;

  insert into public.transactions(
    id,organization_id,account_id,provider_connection_id,provider_code,kind,direction,status,amount_minor,currency,description,pix_key,
    pricing_version_id,pricing_version,fee_minor,pricing_snapshot
  ) values (
    p_transaction_id,p_organization_id,p_account_id,p_provider_connection_id,p_provider_code,p_kind,'out','pending',p_amount_minor,p_currency,p_description,p_pix_key,
    (pricing ->> 'pricing_version_id')::uuid,(pricing ->> 'version')::integer,fee_value,pricing
  );
  insert into public.ledger_journals(transaction_id,kind,currency) values(p_transaction_id,'reserve_outbound',p_currency) returning id into j;
  insert into public.ledger_entries(journal_id,account_id,bucket,amount_minor) values
    (j,p_account_id,'available',-debit_total),(j,p_account_id,'reserved',debit_total);
  insert into public.transaction_events(transaction_id,event_type,payload)
  values(p_transaction_id,'transaction.created',jsonb_build_object('status','pending','amount_minor',p_amount_minor,'fee_minor',fee_value,'debit_total_minor',debit_total,'pricing_version',(pricing ->> 'version')::integer));
  return p_transaction_id;
end;
$$;

create or replace function public.settle_pix_in(p_transaction_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  t public.transactions%rowtype;
  j uuid;
  net_value bigint;
begin
  select * into t from public.transactions where id=p_transaction_id for update;
  if not found then raise exception 'transaction not found'; end if;
  if t.kind <> 'pix_in' then raise exception 'not pix_in'; end if;
  if t.status='succeeded' then return; end if;
  if t.status='failed' then raise exception 'illegal transition failed->succeeded'; end if;

  net_value := t.amount_minor - t.fee_minor;
  if net_value <= 0 then raise exception 'invalid inbound net amount'; end if;

  insert into public.ledger_journals(transaction_id,kind,currency) values(t.id,'settle_pix_in',t.currency) returning id into j;
  if t.fee_minor > 0 then
    insert into public.ledger_entries(journal_id,account_id,bucket,amount_minor) values
      (j,t.account_id,'available',net_value),
      (j,null,'platform_revenue',t.fee_minor),
      (j,null,'clearing',-t.amount_minor);
  else
    insert into public.ledger_entries(journal_id,account_id,bucket,amount_minor) values
      (j,t.account_id,'available',t.amount_minor),
      (j,null,'clearing',-t.amount_minor);
  end if;

  update public.transactions set status='succeeded',completed_at=now(),updated_at=now() where id=t.id;
  insert into public.transaction_events(transaction_id,event_type,payload)
  values(t.id,'transaction.succeeded',jsonb_build_object('amount_minor',t.amount_minor,'fee_minor',t.fee_minor,'net_minor',net_value));
end;
$$;

create or replace function public.complete_outbound(p_transaction_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  t public.transactions%rowtype;
  j uuid;
  debit_total bigint;
begin
  select * into t from public.transactions where id=p_transaction_id for update;
  if not found then raise exception 'transaction not found'; end if;
  if t.kind not in ('transfer','withdrawal') then raise exception 'not outbound'; end if;
  if t.status='succeeded' then return; end if;
  if t.status='failed' then raise exception 'illegal transition failed->succeeded'; end if;

  debit_total := t.amount_minor + t.fee_minor;
  insert into public.ledger_journals(transaction_id,kind,currency) values(t.id,'complete_outbound',t.currency) returning id into j;
  if t.fee_minor > 0 then
    insert into public.ledger_entries(journal_id,account_id,bucket,amount_minor) values
      (j,t.account_id,'reserved',-debit_total),
      (j,null,'clearing',t.amount_minor),
      (j,null,'platform_revenue',t.fee_minor);
  else
    insert into public.ledger_entries(journal_id,account_id,bucket,amount_minor) values
      (j,t.account_id,'reserved',-t.amount_minor),
      (j,null,'clearing',t.amount_minor);
  end if;

  update public.transactions set status='succeeded',completed_at=now(),updated_at=now() where id=t.id;
  insert into public.transaction_events(transaction_id,event_type,payload)
  values(t.id,'transaction.succeeded',jsonb_build_object('amount_minor',t.amount_minor,'fee_minor',t.fee_minor,'debit_total_minor',debit_total));
end;
$$;

create or replace function public.fail_outbound(p_transaction_id uuid, p_code text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  t public.transactions%rowtype;
  j uuid;
  debit_total bigint;
begin
  select * into t from public.transactions where id=p_transaction_id for update;
  if not found then raise exception 'transaction not found'; end if;
  if t.kind not in ('transfer','withdrawal') then raise exception 'not outbound'; end if;
  if t.status='failed' then return; end if;
  if t.status='succeeded' then raise exception 'illegal transition succeeded->failed'; end if;

  debit_total := t.amount_minor + t.fee_minor;
  insert into public.ledger_journals(transaction_id,kind,currency) values(t.id,'release_outbound',t.currency) returning id into j;
  insert into public.ledger_entries(journal_id,account_id,bucket,amount_minor) values
    (j,t.account_id,'reserved',-debit_total),(j,t.account_id,'available',debit_total);
  update public.transactions set status='failed',failure_code=p_code,failure_message=p_message,completed_at=now(),updated_at=now() where id=t.id;
  insert into public.transaction_events(transaction_id,event_type,payload)
  values(t.id,'transaction.failed',jsonb_build_object('code',p_code,'amount_minor',t.amount_minor,'fee_minor',t.fee_minor,'released_minor',debit_total));
end;
$$;

revoke execute on function public.reject_pricing_history_mutation() from public, anon, authenticated;
revoke execute on function public.initialize_merchant_pricing(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.ensure_merchant_pricing_on_insert() from public, anon, authenticated;
revoke execute on function public.merchant_pricing_detail(uuid) from public, anon, authenticated;
revoke execute on function public.set_merchant_pricing(uuid,uuid,jsonb,text) from public, anon, authenticated;
revoke execute on function public.quote_merchant_pricing(uuid,text,bigint) from public, anon, authenticated;
revoke execute on function public.reject_transaction_pricing_mutation() from public, anon, authenticated;
revoke execute on function public.begin_pix_in(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.begin_outbound(uuid,uuid,uuid,text,bigint,text,text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.settle_pix_in(uuid) from public, anon, authenticated;
revoke execute on function public.complete_outbound(uuid) from public, anon, authenticated;
revoke execute on function public.fail_outbound(uuid,text,text) from public, anon, authenticated;

grant execute on function public.initialize_merchant_pricing(uuid,uuid) to service_role;
grant execute on function public.merchant_pricing_detail(uuid) to service_role;
grant execute on function public.set_merchant_pricing(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.quote_merchant_pricing(uuid,text,bigint) to service_role;
grant execute on function public.begin_pix_in(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid) to service_role;
grant execute on function public.begin_outbound(uuid,uuid,uuid,text,bigint,text,text,text,text,uuid) to service_role;
grant execute on function public.settle_pix_in(uuid) to service_role;
grant execute on function public.complete_outbound(uuid) to service_role;
grant execute on function public.fail_outbound(uuid,text,text) to service_role;
