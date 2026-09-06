# Phase 3 — Admin Financeiro + Merchant 360°

Status: IN PROGRESS.

Development branch: `feat/admin-finance-merchant-360`.

Recovered implementation baseline after timeout: `9f0cac522be4735f0a5028b8d49dba1a1f65ddef`.
Validated implementation checkpoint: `d2578b2f26b9109696be66b6a56154666d2674a3`.

## Goal

Give platform administrators a financially correct global control plane and a complete Merchant 360° drill-down without changing the merchant product scope or touching production before CI and read-only preview validation.

## Scope

### Admin Financeiro

Required capabilities:
- Global platform metrics.
- Period selector and financial time-series/charting.
- Global successful Pix volume view.
- Global Pix transaction table across Organizations.
- Merchant ranking and drill-down.

Metric semantics are contractual:
- TPV = successful `pix_in` amount processed in the selected period.
- Flash Pag revenue = frozen transaction `fee_minor` charged by Flash Pag.
- Provider cost = actual cost backed by a verified provider-specific contract.
- Margin = revenue − provider cost only when provider-cost coverage is complete.
- Net profit must not be displayed until all other relevant costs are modeled.

Unknown provider cost stays unknown. Do not infer it from plausible raw payload fields. The deterministic `mock` adapter is the only current zero-cost value treated as known. Pixhub currently has no verified cost contract in the repository, so Pixhub cost and Pixhub-inclusive margin remain unavailable by design.

### Merchant 360°

For a selected Merchant, the admin must be able to inspect:
- Merchant identity/status.
- All Organizations belonging to the Merchant.
- KYC/KYB status and relevant business fields.
- Current Pix pricing.
- Merchant members and roles.
- Accounts and balances by Organization.
- Customer counts by Organization.
- Provider connections by Organization.
- Consolidated recent Pix activity and financial metrics across Organizations.

## Explicit exclusions / guardrails

- Do not reintroduce Transferências in the merchant panel.
- Do not introduce Saques UI in this phase.
- The Phase 3 Admin Financeiro global transaction surface is focused on `pix_in`; do not mix unrelated operation types into TPV.
- Raw provider payloads must remain private.
- Refund/reversal ledgering may receive technical hardening if required by correctness, but it does not replace or reorder Phase 3.
- Do not touch the Railway production service `flash-pag` during implementation/preview validation.

## Current implementation recovered and reconciled from Git

Backend/read-contract work:
- `internal/httpapi/handlers_pricing.go` reads `provider_payload` only inside the server, removes it from responses, and attaches `provider_cost_minor` only for platform admins when the cost helper can prove the value is known.
- `internal/httpapi/provider_cost.go` accepts only verified provider-specific semantics. In the current repository, `mock` is known zero-cost; live providers including Pixhub return unknown.
- `internal/httpapi/provider_cost_test.go` verifies that plausible Pixhub fields such as `feeInCents`, `provider_fee_minor` or generic fee/cost keys are not treated as actual provider cost without a verified contract.
- There is currently no dedicated admin-finance endpoint. Admin Financeiro and Merchant 360° aggregate existing organization-scoped contracts using platform-admin authorization. This preserves the Phase 3 no-migration/no-extra-read-model decision and is acceptable for the current beta while limits are visible.

Frontend/API work:
- `web/src/api/types.ts` models `fee_minor`, frozen pricing fields and platform-admin `provider_cost_minor`.
- `web/src/api/client.ts` provides bounded organization transaction reads, capped server-side at 1,000 rows.
- `web/src/features/platform/admin-finance.ts` implements period filtering and financial aggregation semantics.
- `web/src/features/platform/AdminFinancePage.tsx` implements the global financial dashboard, 7/30/90-day views, chart, merchant ranking and global Pix transaction table.
- `web/src/features/platform/Merchant360Page.tsx` implements the merchant drill-down across all Organizations, including KYC, pricing, members, account/balance context, customer counts, provider connections and recent Pix activity.
- `web/src/features/platform/admin-finance.css` implements responsive Phase 3 layouts.
- `web/src/app/App.tsx` registers `/platform/finance` and `/platform/merchants/:merchantId`.
- `web/src/components/layout/AppShell.tsx` exposes Financeiro to platform admins on desktop/mobile and provides Merchant 360° route context.
- `web/src/features/transactions/TransactionsPage.tsx` filters merchant-visible transaction rows to incoming Pix receipts; the Phase 3 work does not reintroduce Transferências through the merchant transaction surface.

## Implementation principles

- Prefer aggregating existing organization-scoped contracts before introducing schema.
- Platform admins may read organization-scoped APIs across tenants because authorization is enforced server-side.
- Keep provider payload server-side; expose only sanitized derived cost evidence.
- Never treat a field as provider cost merely because its name resembles `fee` or `cost`; the provider adapter/contract must define its semantics and integer-minor unit explicitly.
- Keep financial calculation logic deterministic and isolated from presentation components.
- If a transaction window is truncated by a read limit, surface that limitation rather than pretending totals are complete.
- The current beta implementation fans out reads by Organization. Replace it with a purpose-built server-side read model only when measured merchant/organization scale or latency justifies that complexity.

## Acceptance criteria

Functional:
- Admin Financeiro route is visible to platform admins and inaccessible to non-admins.
- TPV, revenue, provider cost and margin are separate concepts in both code and UI.
- Margin is unavailable when provider-cost evidence is incomplete.
- No net-profit label exists.
- Global transaction list shows only Pix received for this phase.
- Merchant 360° supports Merchants with zero, one or multiple Organizations.
- Merchant 360° shows organization-scoped balances, accounts, customers and connections without crossing tenant boundaries incorrectly.
- KYC and current pricing are shown at Merchant level.
- Platform navigation exposes Financeiro without changing merchant navigation scope.

Security/privacy:
- Platform admin authorization remains server-side.
- Raw `provider_payload` is never returned to browser clients.
- Merchant users do not gain provider-cost visibility intended for platform admins.
- Preview mutation guard remains active at backend and UI layers.

Verification:
- `gofmt` clean.
- `go test ./...` green.
- `go vet ./...` green.
- TypeScript/Vite production build green.
- CI green on the exact branch head being reported.
- `flash-pag-react-preview` source remains `feat/admin-finance-merchant-360`.
- Railway preview deployment is built from the exact expected branch head.
- `/healthz` passes and reports preview read-only mode.
- `/app/`, `/app/platform/finance` and a Merchant 360° SPA route load.
- A safe mutation probe is rejected by preview middleware with HTTP 423 `preview_read_only`.
- Railway production service `flash-pag` remains bound to `feat/minimal-pix-gateway` before and after validation.

## Validated implementation checkpoint

Commit `d2578b2f26b9109696be66b6a56154666d2674a3` passed the full GitHub CI workflow: formatting check, TypeScript typecheck, Vite build, Go tests and Go vet.

Railway preview deployment `b96fc6dc-be7b-4660-ba4e-166e858593a6` deployed that exact commit from `feat/admin-finance-merchant-360` and completed successfully. Runtime validation produced:
- `GET /healthz` → HTTP 200, `{"ok":true,"preview_read_only":true}`.
- `POST /console/register` with harmless `{}` → HTTP 423, code `preview_read_only`; no registration handler mutation executed.
- `GET /app/` → HTTP 200 with React root and bundled assets.
- `GET /app/platform/finance` → HTTP 200 with the same SPA fallback.
- `GET /app/platform/merchants/00000000-0000-0000-0000-000000000000` → HTTP 200 with the same SPA fallback.

Production `flash-pag` remained on `feat/minimal-pix-gateway` throughout the checkpoint.

Phase 3 intentionally remains IN PROGRESS after this technical checkpoint. Authenticated visual/product acceptance and any further agreed Phase 3 refinements should be completed before changing status to COMPLETE.

## Definition of phase completion

Phase 3 may move from IN PROGRESS to COMPLETE only when all acceptance criteria above are verified for the final intended head, product acceptance is complete, and the permanent documentation (`PROJECT_STATE`, `ROADMAP`, `DECISIONS`, this phase document, and relevant RUNBOOK instructions) matches the validated final state.
