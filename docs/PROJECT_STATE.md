# Flash Pag — Project State

Last reconciled from the repository, GitHub CI and Railway preview: 2026-09-06.

## Current development state

- Active development branch: `feat/admin-finance-merchant-360`.
- Phase 1 — KYC/KYB: COMPLETE.
- Phase 2 — Pricing/Taxas: COMPLETE.
- Phase 3 — Admin Financeiro + Merchant 360°: IN PROGRESS.
- Refund/reversal ledgering remains financial-core hardening; it is not the primary Phase 3 scope.

The Phase 3 branch was explicitly reconstructed after an earlier execution timeout instead of assuming interrupted work had persisted. The first recovered implementation head was `9f0cac522be4735f0a5028b8d49dba1a1f65ddef`. Subsequent work added Financeiro/Merchant 360°, strict provider-cost semantics, permanent project documentation and read-only preview validation.

The latest code checkpoint before this documentation update is `395da84d539579d647c37b23cba98104fbc62c46`. It hardens Phase 3 against silent tenant truncation, handles Merchant membership without requiring an Organization and uses exact Organization counts instead of bounded array lengths.

Phase 3 remains IN PROGRESS. Technical gates can be satisfied without declaring product acceptance; authenticated visual/product review remains a separate acceptance step.

## Deployment separation

Railway project: `Flash Pag Beta`.

Production service:
- Service: `flash-pag`.
- Source repo: `matspectrum-ai/Flash-Pag`.
- Source branch: `feat/minimal-pix-gateway`.
- Healthcheck: `/healthz`.
- Production has remained unchanged throughout Phase 3 implementation and preview validation.

Development preview:
- Service: `flash-pag-react-preview`.
- Source repo: `matspectrum-ai/Flash-Pag`.
- Source branch: `feat/admin-finance-merchant-360`.
- Preview is protected by `APP_PREVIEW_READ_ONLY` and `VITE_PREVIEW_READ_ONLY`.
- Last fully validated preview deployment before the latest read-contract hardening: `a176782f-224b-42c7-92c6-5a1121b2d306` at commit `8e158676d2e4a7dd4f2fac5c5a1a087567ecb541`.
- That deployment passed Railway build/tests and `/healthz`, and runtime probes confirmed `preview_read_only:true`, HTTP 423 for a harmless mutating POST, and SPA fallback for `/app/`, Financeiro and Merchant 360° routes.

The newer documentation head must pass exact-head CI and be deployed to this preview before the next technical checkpoint is reported. Production must not be moved.

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

No Phase 3 database migration is currently required. Phase 3 adds read contracts over existing state instead of new persistence.

## Phase 3 implementation currently persisted

Financial correctness:
- `internal/httpapi/handlers_pricing.go` loads provider evidence server-side, removes raw `provider_payload` from browser responses and exposes `provider_cost_minor` only to platform admins when the provider-specific helper can prove the cost.
- `internal/httpapi/provider_cost.go` treats deterministic `mock` cost as known zero and leaves Pixhub/live-provider cost unknown until a verified provider-specific cost contract exists.
- `internal/httpapi/provider_cost_test.go` prevents plausible generic provider fields from being mistaken for cost evidence.

Admin read contracts:
- `internal/httpapi/handlers_admin_tenants.go` paginates Merchant/Organization inventory for platform admins and returns explicit completeness flags. It also reads members at Merchant scope, including Merchants with zero Organizations.
- `internal/supabase/count.go` obtains exact PostgREST counts using `Prefer: count=exact` without materializing full result sets.
- `internal/httpapi/handlers_admin_org_stats.go` returns exact counts for accounts, customers and provider connections for an Organization.
- Admin read routes are protected by `withAdmin`; no new Phase 3 mutations were introduced.

Admin Financeiro:
- `web/src/features/platform/admin-finance.ts` deterministically aggregates only `pix_in` for the selected period.
- Successful Pix contributes TPV and Flash Pag revenue. Pending/failed/ambiguous states are tracked but excluded from completed TPV.
- Provider cost and margin are unavailable when successful transactions lack verified provider-cost evidence.
- `web/src/features/platform/AdminFinancePage.tsx` provides global metrics, 7/30/90-day views, daily TPV chart, merchant ranking and global Pix transaction view.
- Global tenant inventory no longer depends on the bounded `/console/api/me` bootstrap arrays.
- Individual transaction rows use the label `Valor`; TPV is reserved for the aggregate metric.

Merchant 360°:
- `web/src/features/platform/Merchant360Page.tsx` supports zero, one or multiple Organizations.
- It displays Merchant identity/status, KYC/KYB, current Pix pricing, members/roles, Organization balance context, account details, exact account/customer/provider-connection counts, provider connections and consolidated recent Pix activity.
- Exact counts are never inferred from generic list lengths.

Product guardrails:
- Merchant navigation does not expose Transferências.
- Merchant transaction presentation remains focused on incoming Pix.
- Saques UI is deferred to its dedicated later phase.

## Financial semantics / guardrails

- Admin TPV means processed volume; current Phase 3 dashboard scope uses successful `pix_in`.
- Flash Pag revenue means merchant fees charged (`fee_minor`).
- Provider cost means actual provider cost backed by a verified provider-specific contract. Unknown cost is never inferred and never silently assumed zero except the deterministic `mock` adapter.
- Margin = Flash Pag revenue − provider cost, and is available only when provider-cost coverage is complete for the successful Pix set being measured.
- With the current adapters, Pixhub cost and therefore Pixhub-inclusive margin remain unavailable until a verified cost contract is implemented.
- Do not label margin as net profit. Net profit requires modeling all remaining relevant costs.
- Raw provider payload remains private; browser clients receive only authorized sanitized derived evidence.

## Verification state

Code checkpoint `395da84d539579d647c37b23cba98104fbc62c46` passed the substantive GitHub CI stages:
- `gofmt -w ./cmd ./internal && git diff --exit-code`
- web dependency install
- TypeScript typecheck
- Vite production build
- `go test ./...`
- `go vet ./...`

The new permanent-documentation commits create a newer branch head, so exact-head CI and Railway preview validation are still required before reporting a new fully validated checkpoint.

## Current risks / next Phase 3 work

- Pixhub has no verified provider-cost contract; cost and dependent margin intentionally remain unavailable rather than estimated.
- Per-Organization transaction reads remain capped at 1,000 rows and the UI flags truncation. At larger measured scale, a server-side financial read model may be justified.
- Tenant inventory has an explicit 10,000-row safety ceiling and reports incompleteness rather than silently truncating.
- Authenticated visual/product acceptance of Financeiro and Merchant 360° has not been automated in the current session because no connected browser/admin session is available.
- Refund/reversal compensating ledger journals remain pending hardening outside the primary Phase 3 scope.
