# Flash Pag — Decisions

This file records durable product and engineering decisions that should not be rediscovered from chat history.

## D-001 — Money is integer centavos

Status: ACCEPTED.

All BRL monetary amounts use integer centavos in application code and PostgreSQL. Floating point is not permitted for financial amounts.

## D-002 — Ledger history is immutable

Status: ACCEPTED.

Committed ledger entries are not edited in place. Corrections use new compensating journals/reversals. Every committed journal must balance to zero.

## D-003 — Ambiguous provider outcomes are not failures

Status: ACCEPTED.

A provider timeout/unknown outcome remains ambiguous. Preserve the same operation/provider identity and reconcile before retrying an operation that could move money.

## D-004 — Multi-tenant boundary

Status: ACCEPTED.

The commercial tenant is the Merchant. A Merchant can own multiple Organizations. Operational resources such as accounts, customers, provider connections, API keys, webhooks and transactions are scoped to Organizations. Membership roles are merchant-level.

## D-005 — KYC/KYB is a merchant-level lifecycle

Status: ACCEPTED.

KYC/KYB belongs to the Merchant, not to each Organization. Provider onboarding and real-money operations can be gated on merchant approval. KYC documents remain private and are proxied through authenticated backend routes.

## D-006 — Pricing is versioned and transactions freeze fees

Status: ACCEPTED.

Pricing history is immutable. A new commercial change creates a new pricing version. A transaction stores the exact pricing version and `fee_minor` used at creation so historical economics never change when current pricing changes.

## D-007 — Product navigation is not identical to financial-core capability

Status: ACCEPTED.

The backend may support operation types that are not currently exposed in the merchant product UI. Specifically:
- Transferências must not be reintroduced in the merchant panel.
- Saques are deferred to a dedicated later phase.

A future phase must explicitly authorize any UI reintroduction.

## D-008 — Admin financial vocabulary

Status: ACCEPTED.

Admin financial metrics use these exact semantics:
- TPV: processed volume, currently successful `pix_in` within the selected period.
- Flash Pag revenue: fees realized by Flash Pag on successful transactions, using the transaction's frozen `fee_minor`.
- Provider cost: actual provider cost supported by explicit, trustworthy provider evidence.
- Margin: Flash Pag revenue minus provider cost, only when provider-cost coverage is complete.
- Net profit: prohibited as a metric until all other relevant costs are modeled.

A frozen `fee_minor` on a pending, failed or ambiguous transaction remains the immutable commercial pricing snapshot for that transaction; it is not presented or aggregated as realized Flash Pag revenue until the transaction succeeds.

Unknown provider cost is not zero. The deterministic `mock` provider is the only intentional zero-cost exception in the current implementation.

## D-009 — Provider evidence stays private

Status: ACCEPTED.

Raw `provider_payload` must not be exposed to browser clients. Platform-admin APIs may expose sanitized derived fields such as `provider_cost_minor` only when extraction is based on a verified provider-specific cost contract.

## D-010 — Prefer existing contracts before adding Phase 3 schema

Status: ACCEPTED.

Phase 3 should aggregate existing tenant/transaction/account/KYC/pricing contracts before introducing new tables or migrations. Add schema only when a missing durable invariant or required historical fact cannot be represented correctly otherwise.

## D-011 — Production and preview are separate release surfaces

Status: ACCEPTED.

Railway production service `flash-pag` remains bound to the stable production branch (`feat/minimal-pix-gateway`) during development work.

Railway service `flash-pag-react-preview` is the validation target for active React/admin development and must remain read-only using both backend and frontend guards. For Phase 3 it must point to `feat/admin-finance-merchant-360` only after CI is green on the exact branch head.

Never validate a development phase by moving the production service first.

## D-012 — CI + preview validation are Definition-of-Done gates

Status: ACCEPTED.

A phase or substantial feature is not complete merely because code was committed. The exact head must pass CI and be validated on the read-only Railway preview. Documentation must also be updated to reflect the resulting state.

## D-013 — Refund/reversal remains hardening, not Phase 3 scope

Status: ACCEPTED.

Provider refund evidence may exist before compensating reversal ledgering is implemented. Refund/reversal ledgering remains an important financial-core hardening item but does not change the agreed order: Phase 3 is Admin Financeiro + Merchant 360°.

## D-014 — Phase 3 global reads must never silently truncate

Status: ACCEPTED.

Admin Financeiro and Merchant 360° use dedicated read-only admin contracts where existing session/bootstrap contracts are intentionally bounded for UI convenience.

Rules:
- `/console/api/me` is not the source of truth for the global tenant inventory because it has bounded list limits.
- The admin tenant inventory paginates merchants and Organizations up to an explicit safety ceiling and returns `complete=false` if that ceiling is reached.
- Organization counts that are presented as exact use PostgREST `Prefer: count=exact`; they are not inferred from bounded list lengths.
- Merchant membership is queried at merchant scope and remains valid even when a Merchant has zero Organizations.
- Per-Organization transaction reads remain capped at 1,000 rows in the beta aggregation; hitting the cap must be surfaced in the UI instead of treating the metric as complete.

These read contracts do not add Phase 3 persistence or migrations. A dedicated server-side financial read model should only be introduced when measured scale/latency or historical-query requirements justify the additional complexity.

## D-015 — Admin finance uses an explicit Brazil business calendar

Status: ACCEPTED.

Admin Financeiro and Merchant 360° period filters and daily financial buckets use `America/Sao_Paulo` as the business timezone. Browser-local timezone and raw UTC calendar dates must not independently determine 7/30/90-day membership or daily TPV buckets.

This keeps the same Pix near midnight in the same reporting day for every platform administrator regardless of where their browser is running.
