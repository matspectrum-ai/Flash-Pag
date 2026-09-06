-- Immutable pricing history must not be rewritten by an auth-user deletion.
-- Preserve the actor relationship instead of using ON DELETE SET NULL, which would
-- conflict with the pricing-history immutability trigger.

alter table public.merchant_pricing_versions
  drop constraint merchant_pricing_versions_created_by_fkey;

alter table public.merchant_pricing_versions
  add constraint merchant_pricing_versions_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete restrict;
