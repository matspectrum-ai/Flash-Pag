# Phase 2 — Pricing / Taxas

Status: COMPLETE.

## Goal

Introduce merchant-specific pricing with immutable commercial history and freeze the exact fee applied to each financial transaction so later pricing changes cannot rewrite historical economics.

## Delivered scope

- Pricing versions scoped to Merchant.
- Current pricing pointer per Merchant.
- Pricing rules for financial-core operation types: `pix_in`, `transfer`, `withdrawal`.
- Rule components:
  - fixed fee in integer centavos;
  - percentage in basis points;
  - optional minimum fee;
  - optional maximum fee.
- Initial zero-fee pricing for existing merchants to preserve prior beta economics.
- New pricing versions instead of mutating history.
- Transaction-time fee calculation.
- Frozen `pricing_version_id`, version number and exact `fee_minor` on the transaction contract.
- Platform-admin fee management UI and pricing history.
- Transaction UI exposure of the actual frozen fee charged.
- Additional FK/index/audit hardening.

## Persistence

Primary migrations:
- `migrations/0007_merchant_pricing.sql`
- `migrations/0008_pricing_hardening.sql`
- `migrations/0009_pricing_fk_indexes.sql`

Primary tables:
- `merchant_pricing_versions`
- `merchant_pricing_rules`
- `merchant_pricing_current`

Transaction rows retain pricing/fee fields so historical records remain independent from future pricing updates.

## Key invariants

- Monetary fee values use integer centavos; percentage uses integer basis points.
- Pricing history is immutable.
- A commercial change creates a new version.
- Transactions freeze the exact pricing version and exact fee used at creation.
- Min/max fee constraints are validated.
- The current pointer references a pricing version belonging to the same Merchant.
- Pricing audit actor references are hardened without making historical pricing mutable.

## Main application surfaces

Platform admin:
- `/app/platform/pricing` — select Merchant, inspect current/history and create a new version.

Merchant transactions:
- `/app/transactions` — transaction fee is displayed from the frozen transaction data.

Private API:
- `/console/api/admin/pricing/{merchantID}`
- `/console/api/transactions`

## Product boundary

Pricing support for `transfer` and `withdrawal` is a financial-core capability and does not authorize those operations to appear in the current merchant product navigation.

Permanent guardrails:
- Do not reintroduce Transferências in the merchant panel.
- Saques remain deferred to their dedicated phase.

## Phase exit

Phase 2 ended at commit `90d204694fafefe662045b3d2038fbb01feee3fe` (`docs(pricing): define merchant fee semantics`) on the React development line. That exact head passed CI and was successfully deployed to the read-only Railway preview before Phase 3 started.

The only residual inconsistency found when Phase 3 began was README text that still claimed there was no fee engine. That documentation was corrected on the Phase 3 branch; it was not a functional Phase 2 defect.
