# Flash Pag — Project State

Last reconciled from the repository, GitHub CI and Railway preview: 2026-09-06.

## Current development state

- Active development branch: `feat/admin-finance-merchant-360`.
- Phase 1 — KYC/KYB: COMPLETE.
- Phase 2 — Pricing/Taxas: COMPLETE.
- Phase 3 — Admin Financeiro + Merchant 360°: IN PROGRESS.
- Refund/reversal ledgering remains financial-core hardening; it is not the primary Phase 3 scope.

The Phase 3 branch was explicitly reconstructed after an earlier execution timeout instead of assuming the interrupted work state. The initial recovered implementation head was `9f0cac522be4735f0a5028b8d49dba1a1f65ddef`. A concurrent follow-up commit `7a8d249c665894e8990163466061e40cb5a254b7` added the Financeiro navigation and Merchant 360° page context. Subsequent type and provider-cost hardening produced the validated implementation checkpoint `d2578b2f26b9109696be66b6a56154666d2674a3`.

Phase 3 remains IN PROGRESS even though that implementation checkpoint has passed CI and read-only preview validation. The phase status should only move to COMPLETE after explicit product acceptance and any remaining agreed Phase 3 adjustments are closed.

## Deployment separation

Railway project: `Flash Pag Beta`.

Production service:
- Service: `flash-pag`.
- Source repo: `matspectrum-ai/Flash-Pag`.
- Source branch: `feat/minimal-pix-gateway`.
- Healthcheck: `/healthz`.
- Production remained unchanged throughout Phase 3 implementation and preview validation.

Development preview:
- Service: `flash-pag-react-preview`.
- Source repo: `matspectrum-ai/Flash-Pag`.
- Source branch: `feat/admin-finance-merchant-360`.
- Preview is protected by `APP_PREVIEW_READ_ONLY` and `VITE_PREVIEW_READ_ONLY`.
- Validated implementation deployment: `b96fc6dc-be7b-4660-ba4e-166e858593a6`.
- Validated implementation commit: `d2578b2f26b9109696be66b6a56154666d2674a3`.
- Railway build completed successfully, application started on `:8080`, and `/healthz` passed.
- Runtime `/healthz` returned HTTP 200 with `{"ok":true,"preview_read_only":true}`.
- Safe mutation probe `POST /console/register` with `{}` returned HTTP 423 and error code `preview_read_only`, confirming backend mutation blocking before registration logic.
- `/app/`, `/app/platform/finance`, and `/app/platform/merchants/00000000-0000-0000-0000-000000000000` each returned HTTP 200 with the React SPA root and the same bundled asset references, confirming SPA fallback for Phase 3 routes.

The linked preview follows the Phase 3 branch. Documentation-only commits after the validated implementation checkpoint must still pass branch CI and be served by the preview before a final status report is made.

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
- `internal/httpapi/handlers_pricing.go` loads transaction provider evidence server-side, removes raw `provider_payload` before responding, and exposes sanitized `provider_cost_minor` only to platform admins when the provider-cost helper says the value is known.
- `internal/httpapi/provider_cost.go` is intentionally conservative: the deterministic `mock` adapter is known to cost zero; no live provider currently has a verified cost contract in the repository, so Pixhub/other live-provider costs return unknown.
- `internal/httpapi/provider_cost_test.go` locks that behavior and rejects inference from plausible-looking raw fields such as `feeInCents` or `provider_fee_minor` until a provider-specific contract is verified.
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
- The merchant Transactions page filters its displayed rows to incoming Pix receipts, so Transferências are not reintroduced through the generic transaction list.

## Financial semantics / guardrails

- Do not reintroduce Transferências in the merchant panel.
- Saques are deferred to their dedicated later phase.
- Admin TPV means processed volume; current Phase 3 dashboard scope uses successful `pix_in`.
- Flash Pag revenue means merchant fees charged (`fee_minor`).
- Provider cost means actual provider cost backed by a verified provider-specific contract. Unknown cost is never inferred from raw fields and never silently assumed zero except the deterministic `mock` adapter.
- Margin = Flash Pag revenue − provider cost, and is available only when provider-cost coverage is complete for the successful Pix set being measured.
- With the current adapters, Pixhub cost and therefore any Pixhub-inclusive margin remain unavailable until a verified cost contract is implemented.
- Do not label margin as net profit. Net profit requires modeling all remaining relevant costs.
- Raw provider payload remains private; browser clients receive only sanitized derived cost evidence where authorized.

## Verification state

Validated implementation checkpoint `d2578b2f26b9109696be66b6a56154666d2674a3` passed the full GitHub CI workflow:
- `gofmt -w ./cmd ./internal && git diff --exit-code`
- web dependency install
- TypeScript typecheck
- Vite production build
- `go test ./...`
- `go vet ./...`

The same implementation checkpoint was built and served successfully by Railway preview deployment `b96fc6dc-be7b-4660-ba4e-166e858593a6`, with health, SPA fallback and backend read-only enforcement validated as described above.

## Current risks / next Phase 3 work

- Pixhub has no verified provider-cost contract in the repository; its cost and any dependent margin intentionally remain unavailable rather than estimated.
- The current admin dashboard fans out bounded reads per Organization; each Organization is capped at 1,000 loaded transactions and the UI flags truncation. A purpose-built server-side read model should only be introduced later if measured scale/latency justifies it.
- The preview validates route delivery and read-only enforcement, but authenticated visual/product review of Financeiro and Merchant 360° remains a useful acceptance step before declaring the phase COMPLETE.
- Refund/reversal compensating ledger journals remain pending hardening outside the primary Phase 3 scope.
