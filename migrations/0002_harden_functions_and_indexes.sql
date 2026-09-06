-- Harden internal financial functions against search_path manipulation.
alter function public.reject_ledger_mutation() set search_path = '';
alter function public.assert_journal_balanced() set search_path = '';
alter function public.account_balance(uuid, uuid) set search_path = '';
alter function public.claim_idempotency(uuid, text, text, text, uuid) set search_path = '';
alter function public.finish_idempotency(uuid, text, text, text, jsonb) set search_path = '';
alter function public.begin_pix_in(uuid, uuid, uuid, uuid, bigint, text, text, text, uuid) set search_path = '';
alter function public.begin_outbound(uuid, uuid, uuid, text, bigint, text, text, text, text, uuid) set search_path = '';
alter function public.settle_pix_in(uuid) set search_path = '';
alter function public.complete_outbound(uuid) set search_path = '';
alter function public.fail_outbound(uuid, text, text) set search_path = '';
alter function public.enqueue_webhook_event(uuid, text, jsonb) set search_path = '';
alter function public.claim_webhook_deliveries(integer) set search_path = '';

-- Cover foreign keys used during deletes, reconciliation, and audit lookups.
create index merchant_users_user_id_idx on public.merchant_users(user_id);
create index transactions_customer_id_idx on public.transactions(customer_id);
create index ledger_journals_transaction_id_idx on public.ledger_journals(transaction_id);
create index ledger_journals_reversal_of_idx on public.ledger_journals(reversal_of);
create index webhook_deliveries_organization_id_idx on public.webhook_deliveries(organization_id);
