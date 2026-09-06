# Flash Pag — Project State

Last reconciled from the repository and deployment configuration: 2026-09-06.

## Current development state

- Active development branch: `feat/admin-finance-merchant-360`.
- Phase 1 — KYC/KYB: COMPLETE.
- Phase 2 — Pricing/Taxas: COMPLETE.
- Phase 3 — Admin Financeiro + Merchant 360°: IN PROGRESS until exact-head CI and Railway preview validation are complete.
- Refund/reversal ledgering remains financial-core hardening; it is not the primary Phase 3 scope.

The Phase 3 branch was explicitly reconstructed after an earlier execution timeout. The initial recovered implementation head was `9f0cac522be4735f0a5028b8d49dba1a1f65ddef`. A concurrent follow-up commit `7a8d249c665894e8990163466061e40cb5a254b7` added the Financeiro navigation and Merchant 360° page context before this permanent documentation chain was created. Later type-contract hardening reached `79f9c5073e03b600518021ceda380d53edfd3c5d`, which passed the full repository CI pipeline.

## Deployment separation

Railway project: `Flash Pag Beta`.

Production service:
- Service: `flash-pag`.
- Source repo: `matspectrum-ai/Flash-Pag`.
- Source branch: `feat/minimal-pix-gateway`.
- Healthcheck: `/healthz`.
- Production must remain untouched while Phase 3 is implemented and validated.

Development preview:
- Service: `flash-pag-react-preview`.
- Source repo: `matspectrum-ai/Flash-Pag`.
- Current source branch at this reconciliation point: `feat/react-console`.
- Preview is protected by `APP_PREVIEW_READ_ONLY` and `VITE_PREVIEW_READ_ONLY`.
- Phase 3 Definition of Done requires moving only this preview service to `feat/admin-finance-merchant-360` after CI is green on the exact intended head, then validating build, `/healthz`, SPA routes and read-only enforcement.

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
- Embedded into the Go binary at image-build time.
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

No Phase 3 database migration is currently required. Phase 3 deliberately aggregates existing organization-scoped contracts unless a missing durable invariant proves that new persistence is necessary.

## Phase 3 implementation currently persisted

Backend/read-contract work:
- `internal/httpapi/handlers_pricing.go` loads transaction provider evidence server-side, removes raw `provider_payload` before responding, and exposes sanitized `provider_cost_minor` only to platform admins when explicit minor-unit cost evidence exists.
- `internal/httpapi/provider_cost.go` contains deterministic provider-cost extraction.
- `internal/httpapi/provider_cost_test.go` covers explicit minor-unit evidence, unknown cost and the deterministic zero-cost `mock` adapter.
- No dedicated `/console/api/admin/finance` read model is currently registered. The Phase 3 UI aggregates existing organization-scoped admin-authorized contracts. This keeps Phase 3 schema-free but creates bounded client fan-out that is explicitly surfaced when transaction limits are reached.

Frontend/API work:
- `web/src/api/types.ts` contains frozen fee/pricing and admin-only provider-cost fields on the transaction contract.
- `web/src/api/client.ts` exposes bounded transaction reads used by the admin aggregation.
- `web/src/features/platform/admin-finance.ts` implements the testable aggregation semantics used by the admin UI.
- `web/src/features/platform/AdminFinancePage.tsx` implements the global financial dashboard, daily chart, merchant ranking and global Pix transaction view.
- `web/src/features/platform/Merchant360Page.tsx` implements merchant-level drill-down across all Organizations.
- `web/src/features/platform/admin-finance.css` contains the Phase 3 layouts.
- `web/src/app/App.tsx` registers `/platform/finance` and `/platform/merchants/:merchantId`.
- `web/src/components/layout/AppShell.tsx` exposes Financeiro in the platform-admin navigation and provides Merchant 360° route metadata.

## Financial semantics / guardrails

- Do not reintroduce Transferências in the merchant panel.
- Saques are deferred to their dedicated later phase.
- Admin TPV means processed volume; current Phase 3 dashboard scope uses successful `pix_in`.
- Flash Pag revenue means merchant fees charged (`fee_minor`).
- Provider cost means actual provider cost supported by explicit evidence. Missing provider cost is unknown, never silently assumed zero except the deterministic `mock` adapter.
- Margin = Flash Pag revenue − provider cost, and is available only when provider-cost coverage is complete for the successful Pix set being measured.
- Do not label margin as net profit. Net profit requires modeling all remaining relevant costs.
- Raw provider payload remains private; browser clients receive only sanitized derived cost evidence where authorized.

## Verification state

Confirmed green CI for implementation head `79f9c5073e03b600518021ceda380d53edfd3c5d`:
- `gofmt -w ./cmd ./internal && git diff --exit-code`
- web dependency install
- TypeScript typecheck
- Vite production build
- `go test ./...`
- `go vet ./...`

Because permanent documentation corrections create newer commits, the final exact head still requires its own green CI before preview promotion.

## Current risks / open validation

- `flash-pag-react-preview` has not yet been switched from `feat/react-console` to `feat/admin-finance-merchant-360`.
- The final documentation-corrected head must pass CI before that switch.
- Provider-cost extraction depends on explicit minor-unit fields present in provider evidence. If Pixhub does not provide a trustworthy cost field, provider cost and margin remain unavailable rather than estimated.
- The current admin dashboard fans out bounded reads per Organization; each Organization is capped at 1,000 loaded transactions and the UI flags truncation. A purpose-built server-side read model should only be introduced later if measured scale/latency justifies it.
- Refund/reversal compensating ledger journals remain pending hardening.
