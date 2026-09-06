# Flash Pag — Project State

Last reconstructed from repository state: 2026-09-06.

## Current development state

- Active development branch: `feat/admin-finance-merchant-360`.
- Recovered pre-documentation head: `9f0cac522be4735f0a5028b8d49dba1a1f65ddef` (`feat(admin): route finance dashboard and merchant 360`).
- Phase 1 — KYC/KYB: COMPLETE.
- Phase 2 — Pricing/Taxas: COMPLETE, with only documentation cleanup remaining at the start of Phase 3; README has since been aligned.
- Phase 3 — Admin Financeiro + Merchant 360°: IN PROGRESS.
- Refund/reversal ledgering remains financial-core hardening; it is not the primary Phase 3 scope.

## Deployment separation

Railway project: `Flash Pag Beta`.

Production service:
- Service: `flash-pag`.
- Source branch: `feat/minimal-pix-gateway`.
- Production must remain untouched while development phases are validated.

Development preview:
- Service: `flash-pag-react-preview`.
- Preview is read-only through `APP_PREVIEW_READ_ONLY` and `VITE_PREVIEW_READ_ONLY`.
- At this snapshot the service source is still `feat/react-console`; Phase 3 Definition of Done requires moving only this preview service to `feat/admin-finance-merchant-360` after CI is green, then validating build, `/healthz`, application load and read-only protection.

## Implemented architecture

Backend:
- Go 1.24, standard library HTTP stack.
- Supabase Postgres + Auth.
- Integer BRL centavos for monetary values.
- Immutable double-entry ledger journals.
- Provider interface under `internal/provider` with `mock` and `pixhub` adapters.
- Encrypted provider credentials using `APP_MASTER_KEY_B64`.
- Durable outbound merchant webhooks and provider callback ingestion.
- Idempotency for financial POST operations.
- Read-only provider reconciliation.

Frontend:
- React + TypeScript + Vite.
- Embedded into the Go binary at image build time.
- Merchant and platform-admin surfaces share authenticated `/console/api/*` contracts.

## Schema history

- `0001_init.sql`: initial SaaS, accounts, ledger, transactions, customers, integrations, webhooks and financial RPCs.
- `0002_harden_functions_and_indexes.sql`: initial hardening/indexes.
- `0003_merchant_members.sql`: merchant membership/roles.
- `0004_kyc_onboarding.sql`: KYC/KYB lifecycle and onboarding.
- `0005_kyc_invariants.sql`: KYC transition/document invariants.
- `0006_kyc_indexes.sql`: KYC performance indexes.
- `0007_merchant_pricing.sql`: versioned merchant pricing and frozen transaction fees.
- `0008_pricing_hardening.sql`: pricing hardening.
- `0009_pricing_fk_indexes.sql`: pricing FK/index coverage.

No Phase 3 database migration is currently required; Phase 3 is being built on existing persisted contracts unless a missing invariant proves otherwise.

## Phase 3 persisted work recovered after timeout

The following work is confirmed present in the branch tree:
- `internal/httpapi/handlers_admin_finance.go`
- `internal/httpapi/handlers_admin_finance_test.go`
- `internal/httpapi/handlers_pricing.go` changes that expose sanitized `provider_cost_minor` only to platform admins when explicit provider evidence exists.
- `web/src/api/types.ts` finance fields.
- `web/src/api/client.ts` high-limit transaction reader.
- `web/src/features/platform/admin-finance.ts` aggregation model.
- `web/src/features/platform/AdminFinancePage.tsx`.
- `web/src/features/platform/Merchant360Page.tsx`.
- `web/src/features/platform/admin-finance.css`.
- `web/src/app/App.tsx` routes for `/platform/finance` and `/platform/merchants/:merchantId`.

The recovered implementation is not considered complete until CI passes and the Railway preview is switched to the Phase 3 branch and validated.

## Non-negotiable product guardrails

- Do not reintroduce Transferências in the merchant panel.
- Saques are deferred to their dedicated later phase.
- Admin TPV means processed volume only; current Phase 3 dashboard scope uses successful `pix_in`.
- Flash Pag revenue means merchant fees charged (`fee_minor`).
- Provider cost means actual provider cost supported by explicit evidence. Missing cost is unknown, never assumed zero except deterministic `mock` provider behavior.
- Margin = Flash Pag revenue − provider cost, only when provider cost coverage is complete.
- Do not label margin as net profit. Net profit requires modeling all other operating costs.
- Provider raw payload remains private; only sanitized cost evidence may reach the platform-admin UI.

## Current risks / open validation

- Phase 3 branch has not yet been accepted by CI after the recovered implementation.
- `flash-pag-react-preview` has not yet been moved from `feat/react-console` to `feat/admin-finance-merchant-360`.
- UI/navigation wiring and TypeScript/Go compilation must be checked by CI before preview promotion.
- Cost extraction depends on explicit minor-unit fields present in provider evidence. If Pixhub does not provide a trustworthy cost field, provider cost and margin must remain unavailable.
- Refund/reversal compensating ledger journals remain pending hardening.
