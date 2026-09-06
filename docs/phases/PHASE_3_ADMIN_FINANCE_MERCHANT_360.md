# Phase 3 — Admin Financeiro + Merchant 360°

Status: IN PROGRESS.

Development branch: `feat/admin-finance-merchant-360`.

Recovered implementation baseline after timeout: `9f0cac522be4735f0a5028b8d49dba1a1f65ddef`.

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
- Provider cost = actual cost supported by explicit trustworthy provider evidence.
- Margin = revenue − provider cost only when provider-cost coverage is complete.
- Net profit must not be displayed until all other relevant costs are modeled.

When provider cost is unknown, it stays unknown; the UI must not substitute zero. The deterministic `mock` adapter is the only zero-cost exception currently treated as known.

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

## Current implementation recovered from Git

Confirmed persisted before this documentation update:
- `internal/httpapi/handlers_admin_finance.go`
- `internal/httpapi/handlers_admin_finance_test.go`
- sanitized `provider_cost_minor` derivation in the admin transaction path
- `web/src/api/types.ts` finance fields
- `web/src/api/client.ts` high-limit transaction reader
- `web/src/features/platform/admin-finance.ts`
- `web/src/features/platform/AdminFinancePage.tsx`
- `web/src/features/platform/Merchant360Page.tsx`
- `web/src/features/platform/admin-finance.css`
- `/platform/finance` and `/platform/merchants/:merchantId` React routes

This persisted code is a work-in-progress, not accepted output. It must still pass CI and preview validation.

## Implementation principles

- Prefer aggregating existing organization-scoped contracts before introducing schema.
- Platform admins may use organization-scoped APIs across tenants because authorization is server-side and admin-specific.
- Keep provider payload server-side; expose only sanitized derived cost evidence.
- Keep the financial calculation model deterministic and testable outside React components.
- If a transaction window is truncated by a read limit, surface that limitation rather than pretending totals are complete.
- Avoid N+1 growth where practical; if current fan-out becomes operationally expensive, replace it with a purpose-built admin read model in a later hardening pass backed by measurements.

## Acceptance criteria

Functional:
- Admin Financeiro route is visible to platform admins and absent/inaccessible to non-admins.
- TPV, revenue, provider cost and margin are separate concepts in both code and UI.
- Margin is unavailable when provider-cost evidence is incomplete.
- No net-profit label exists.
- Global transaction list shows only Pix received for this phase.
- Merchant 360° supports Merchants with zero, one or multiple Organizations.
- Merchant 360° shows organization-scoped balances, accounts, customers and connections without crossing tenant boundaries incorrectly.
- KYC and current pricing are shown at Merchant level.

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
- CI green on the exact final branch head.
- `flash-pag-react-preview` source switched to `feat/admin-finance-merchant-360` only after CI green.
- Railway preview deployment built from the exact expected commit.
- `/healthz` passes.
- `/app/`, `/app/platform/finance` and a Merchant 360° route load through the SPA.
- Read-only preview protection is confirmed.
- Railway production service `flash-pag` remains bound to `feat/minimal-pix-gateway` before and after validation.

## Definition of phase completion

Phase 3 may move from IN PROGRESS to COMPLETE only when all acceptance criteria above are verified and the permanent documentation (`PROJECT_STATE`, `ROADMAP`, `DECISIONS`, this phase document, and relevant RUNBOOK instructions) is updated to match the validated final state.
