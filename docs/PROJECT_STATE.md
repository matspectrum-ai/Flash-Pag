# Flash Pag — Project State

Last reconciled from the repository, GitHub CI and Railway preview: 2026-09-06.

## Current development state

- Active development branch: `feat/admin-finance-merchant-360`.
- Phase 1 — KYC/KYB: COMPLETE.
- Phase 2 — Pricing/Taxas: COMPLETE.
- Phase 3 — Admin Financeiro + Merchant 360°: IN PROGRESS.
- Refund/reversal ledgering remains financial-core hardening; it is not the primary Phase 3 scope.

The latest implementation code checkpoint before this documentation reconciliation is `42630f40de04f5676b404dc2409ae06ed869386c`. The subsequent decision commit `9f4a60f981f083ea9f64beb27418444c9678d877` records the finalized revenue-realization and business-timezone contracts.

Phase 3 remains IN PROGRESS because authenticated visual/product acceptance is a separate release gate. Technical CI/runtime validation does not substitute for that product review.

## Deployment separation

Railway project: `Flash Pag Beta`.

Production service:
- Service: `flash-pag`.
- Source repo: `matspectrum-ai/Flash-Pag`.
- Source branch: `feat/minimal-pix-gateway`.
- Healthcheck: `/healthz`.
- Production has remained unchanged throughout Phase 3 implementation and preview validation.

Stable development preview:
- Service: `flash-pag-react-preview`.
- Source repo: `matspectrum-ai/Flash-Pag`.
- Configured source branch: `feat/admin-finance-merchant-360`.
- Preview is protected by `APP_PREVIEW_READ_ONLY` and `VITE_PREVIEW_READ_ONLY`.
- The Railway connector currently redeploys an older cached source snapshot instead of advancing this service to the Git branch head, so it is not used as evidence for newer exact-head validation.

Exact-head validation workaround:
- Exact commit images are built from a pinned Git SHA with `VITE_PREVIEW_READ_ONLY=true` and no secrets embedded in the image.
- Railway service `flash-pag-phase3-dd630-preview` validated this approach for commit `dd630ade7984eb445dc1aa7097ccdfd38b253644`.
- Its deployment `24c05e4c-a2aa-4089-87e5-6d9a67c37062` completed successfully.
- Runtime probes confirmed `/healthz` HTTP 200 with `preview_read_only:true`, SPA routes for `/app/`, Financeiro and Merchant 360° returning HTTP 200, and a harmless mutating POST rejected with HTTP 423 `preview_read_only`.
- Runtime secrets are referenced internally from the existing preview service; they are not embedded in the image or exposed in repository files.

After the current documentation reconciliation, the final branch head must pass CI and receive the same exact-image runtime validation before a new technical checkpoint is declared.

## Platform portability benchmark

An isolated Render benchmark in Virginia was built from exact commit `1a2ca1753b724aaa2682d8b3e3d9b51acedcb2b8`, with auto-deploy disabled and read-only preview behavior enabled. It was intentionally not given live Supabase secrets.

A GitHub-hosted Central US probe compared Railway and Render using the same endpoint sequence:
- `/healthz` returned HTTP 200 and `preview_read_only:true` on both platforms.
- `/app/`, `/app/platform/finance`, and a Merchant 360° SPA route returned HTTP 200 on both platforms.
- A harmless POST to `/console/register` was rejected with HTTP 423 `preview_read_only` on both platforms.
- Observed warm request latency was broadly similar: Railway approximately 0.11–0.14 s and Render approximately 0.10–0.18 s from that runner.

Railway remains the preferred host for the current phase because it is already the operating environment and the benchmark showed no material advantage that justifies migration risk during Phase 3. The architecture remains portable: stateless Go HTTP service, embedded React/Vite assets and external Supabase state.

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
- `web/src/features/platform/admin-finance.ts` uses `America/Sao_Paulo` for period membership and daily financial buckets so browser-local timezone and UTC boundaries cannot disagree about the reporting day.
- Flash Pag revenue is realized only for successful Pix. A frozen `fee_minor` on pending, failed or ambiguous transactions remains pricing evidence and is not displayed as realized row revenue.
- Provider-cost subtotals are not presented as a complete cost when coverage is incomplete; margin remains unavailable until coverage is complete.

Admin read contracts:
- `internal/httpapi/handlers_admin_tenants.go` paginates Merchant/Organization inventory for platform admins and returns explicit completeness flags. It also reads members at Merchant scope, including Merchants with zero Organizations.
- `internal/supabase/count.go` obtains exact PostgREST counts using `Prefer: count=exact` without materializing full result sets.
- `internal/httpapi/handlers_admin_org_stats.go` returns exact counts for accounts, customers and provider connections for an Organization.
- Admin read routes are protected by `withAdmin`; no new Phase 3 mutations were introduced.

Admin Financeiro:
- Aggregates only `pix_in` in the selected 7/30/90-day business-calendar window.
- Successful Pix contributes TPV and realized Flash Pag revenue.
- Global metrics, daily TPV, merchant ranking and global Pix rows preserve the distinction between amount, revenue, provider cost and margin.
- Global tenant inventory uses the dedicated admin inventory instead of bounded `/console/api/me` arrays.
- Incompleteness/read errors are surfaced instead of silently presenting bounded or failed reads as complete data.

Merchant 360°:
- Supports zero, one or multiple Organizations.
- Displays Merchant identity/status, KYC/KYB, current Pix pricing, members/roles, Organization balance context, account details, exact account/customer/provider-connection counts, provider connections and consolidated recent Pix activity.
- Missing pricing rules are distinct from explicitly configured no-minimum/no-maximum rules.
- Failed account, balance, provider-connection, membership, KYC or pricing reads are shown as unavailable/partial rather than being mislabeled as empty or zero state.
- Exact counts are never inferred from generic list lengths.

Product guardrails:
- Merchant navigation does not expose Transferências.
- Merchant transaction presentation remains focused on incoming Pix.
- Saques UI is deferred to its dedicated later phase.

## Financial semantics / guardrails

- Admin TPV means successful processed `pix_in` volume in the selected business-calendar period.
- Flash Pag revenue means realized merchant fees on successful Pix, using frozen transaction `fee_minor`.
- Provider cost means actual provider cost backed by a verified provider-specific contract. Unknown cost is never inferred and never silently assumed zero except the deterministic `mock` adapter.
- Margin = Flash Pag revenue − provider cost, and is available only when provider-cost coverage is complete for the successful Pix set being measured.
- With the current adapters, Pixhub cost and therefore Pixhub-inclusive margin remain unavailable until a verified cost contract is implemented.
- Admin financial day boundaries use `America/Sao_Paulo`.
- Do not label margin as net profit. Net profit requires modeling all remaining relevant costs.
- Raw provider payload remains private; browser clients receive only authorized sanitized derived evidence.

## Verification state

Validated earlier exact-image checkpoint `dd630ade7984eb445dc1aa7097ccdfd38b253644`:
- GitHub CI green.
- Railway exact-image deployment green.
- `/healthz` green with read-only mode.
- Financeiro and Merchant 360° SPA fallback green.
- HTTP 423 mutation guard green.
- Production remained on `feat/minimal-pix-gateway`.

The implementation subsequently received the financial-date, row-revenue and incomplete-read correctness fixes described above. The reconciled documentation head created by this update sequence must now pass the same CI and exact-image preview gate.

## Current risks / next Phase 3 work

- Pixhub has no verified provider-cost contract; cost and dependent margin intentionally remain unavailable rather than estimated.
- Per-Organization transaction reads remain capped at 1,000 rows and the UI flags truncation. At larger measured scale, a server-side financial read model may be justified.
- Tenant inventory has an explicit 10,000-row safety ceiling and reports incompleteness rather than silently truncating.
- Authenticated visual/product acceptance of Financeiro and Merchant 360° is still pending because the Opera Browser Connector is currently disconnected and no repository-documented admin test credential exists.
- Refund/reversal compensating ledger journals remain pending hardening outside the primary Phase 3 scope.
