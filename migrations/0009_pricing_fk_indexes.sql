-- Cover composite pricing foreign keys used by updates/deletes and integrity checks.

create index merchant_pricing_current_merchant_version_idx
  on public.merchant_pricing_current(merchant_id, pricing_version_id);

create index merchant_pricing_rules_merchant_version_idx
  on public.merchant_pricing_rules(merchant_id, pricing_version_id);
