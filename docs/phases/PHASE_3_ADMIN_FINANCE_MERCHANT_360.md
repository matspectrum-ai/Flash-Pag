# Phase 3 — Admin Financeiro + Merchant 360°

Status: IN PROGRESS.

Development branch: `feat/admin-finance-merchant-360`.

Recovered implementation baseline after timeout: `9f0cac522be4735f0a5028b8d49dba1a1f65ddef`.
Latest implementation code checkpoint before this documentation reconciliation: `42630f40de04f5676b404dc2409ae06ed869386c`.
Latest durable financial-decision checkpoint before this documentation reconciliation: `9f4a60f981f083ea9f64beb27418444c9678d877`.

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
- TPV = successful `pix_in` amount processed in the selected business-calendar period.
- Flash Pag revenue = realized frozen transaction `fee_minor` from successful Pix only.
- Provider cost = actual cost backed by a verified provider-specific contract.
- Margin = revenue − provider cost only when provider-cost coverage is complete.
- Net profit must not be displayed until all other relevant costs are modeled.
- Financial period membership and daily buckets use `America/Sao_Paulo`; browser-local timezone and raw UTC day boundaries do not independently define the reporting day.

A frozen `fee_minor` on pending, failed or ambiguous Pix remains immutable pricing evidence but is not realized revenue. Unknown provider cost stays unknown. Do not infer it from plausible raw payload fields. The deterministic `mock` adapter is the only current zero-cost value treated as known. Pixhub currently has no verified cost contract in the repository, so Pixhub cost and Pixhub-inclusive margin remain unavailable by design.

### Merchant 360°

For a selected Merchant, the admin must be able to inspect:
- Merchant identity/status.
- All Organizations belonging to the Merchant.
- KYC/KYB status and relevant business fields.
- Current Pix pricing.
- Merchant members and roles, including Merchants with zero Organizations.
- Accounts and Organization-level balance context.
- Exact customer/account/provider-connection counts by Organization.
- Provider connection details by Organization.
- Consolidated recent Pix activity and financial metrics across Organizations.
- Explicit unavailable/partial states when an upstream administrative read fails; failed reads must never be rendered as real empty or zero business state.

## Explicit exclusions / guardrails

- Do not reintroduce Transferências in the merchant panel.
- Do not introduce Saques UI in this phase.
- The Phase 3 Admin Financeiro global transaction surface is focused on `pix_in`; do not mix unrelated operation types into TPV.
- Raw provider payloads must remain private.
- Refund/reversal ledgering may receive technical hardening if required by correctness, but it does not replace or reorder Phase 3.
- Do not touch the Railway production service `flash-pag` during implementation/preview validation.

## Current implementation reconciled from Git

Backend/read-contract work:
- `internal/httpapi/handlers_pricing.go` reads `provider_payload` only inside the server, removes it from responses, and attaches `provider_cost_minor` only for platform admins when the cost helper can prove the value is known.
- `internal/httpapi/provider_cost.go` accepts only verified provider-specific semantics. In the current repository, `mock` is known zero-cost; live providers including Pixhub return unknown.
- `internal/httpapi/provider_cost_test.go` verifies that plausible Pixhub fields such as `feeInCents`, `provider_fee_minor` or generic fee/cost keys are not treated as actual provider cost without a verified contract.
- `internal/httpapi/handlers_admin_tenants.go` provides a paginated read-only admin tenant inventory and merchant-level membership reads. Inventory safety ceilings are explicit and return `complete=false` rather than silently truncating.
- `internal/supabase/count.go` adds exact PostgREST counting without materializing full result sets.
- `internal/httpapi/handlers_admin_org_stats.go` exposes exact Organization counts for accounts, customers and provider connections and validates the Organization exists.
- No Phase 3 database migration is required. These are read contracts over existing data and invariants.
- There is no dedicated persisted admin-finance read model. Financial aggregation still uses bounded Organization transaction reads, with truncation surfaced to the user.

Frontend/API work:
- `web/src/api/types.ts` models frozen pricing, platform-admin provider cost, tenant-inventory completeness and merchant-member completeness.
- `web/src/api/client.ts` exposes tenant inventory, merchant members, exact Organization stats and bounded transaction reads.
- `web/src/features/platform/admin-finance.ts` implements deterministic 7/30/90-day business-calendar filtering and financial aggregation using `America/Sao_Paulo`.
- `web/src/features/platform/AdminFinancePage.tsx` implements the global financial dashboard, chart, merchant ranking and global Pix transaction table. It distinguishes realized revenue from frozen fee evidence on non-successful transactions and does not present an unknown provider-cost total as confirmed zero.
- `web/src/features/platform/Merchant360Page.tsx` implements merchant drill-down across zero, one or multiple Organizations, including KYC, pricing, members, accounts, balance context, exact operational counts, provider connections and recent Pix activity.
- Merchant 360° distinguishes missing pricing rules from explicitly configured no-minimum/no-maximum rules and distinguishes failed reads from true empty states.
- Transaction table columns use `Valor` at row level; TPV remains an aggregate metric and is not used as a synonym for every transaction amount.
- `web/src/features/platform/admin-finance.css` implements responsive Phase 3 layouts.
- `web/src/app/App.tsx` registers `/platform/finance` and `/platform/merchants/:merchantId`.
- `web/src/components/layout/AppShell.tsx` exposes Financeiro to platform admins on desktop/mobile and provides Merchant 360° route context.
- `web/src/features/transactions/TransactionsPage.tsx` filters merchant-visible transaction rows to incoming Pix receipts; the Phase 3 work does not reintroduce Transferências through the merchant transaction surface.

## Implementation principles

- Prefer read-only contracts over new persistence when existing facts can be queried correctly.
- Platform admins may read organization-scoped APIs across tenants because authorization is enforced server-side.
- Keep provider payload server-side; expose only sanitized derived cost evidence.
- Never treat a field as provider cost merely because its name resembles `fee` or `cost`; the provider adapter/contract must define its semantics and integer-minor unit explicitly.
- Keep financial calculation logic deterministic and isolated from presentation components.
- Use one explicit business timezone for period membership and daily financial buckets.
- Never infer global/exact counts from bounded arrays. Use pagination or exact count contracts and surface safety ceilings.
- Never render a failed administrative read as a true empty list, zero count or unconfigured commercial state.
- If a transaction window is truncated by a read limit, surface that limitation rather than pretending totals are complete.
- Replace client fan-out with a purpose-built server-side financial read model only when measured scale, latency or historical-query requirements justify that complexity.

## Acceptance criteria

Functional:
- Admin Financeiro route is visible to platform admins and inaccessible to non-admins.
- TPV, realized revenue, provider cost and margin are separate concepts in both code and UI.
- Pending/failed/ambiguous transaction `fee_minor` is not presented as realized row revenue.
- Margin is unavailable when provider-cost evidence is incomplete.
- A provider-cost subtotal is not presented as a complete zero-cost total when evidence is missing.
- No net-profit label exists.
- 7/30/90-day membership and daily chart buckets use `America/Sao_Paulo` consistently.
- Global transaction list shows only Pix received for this phase.
- Global tenant inventory does not silently inherit `/me` list limits.
- Merchant 360° supports Merchants with zero, one or multiple Organizations.
- Merchant members remain readable even when the Merchant has zero Organizations.
- Organization customer/account/provider counts shown as exact are backed by exact count contracts.
- Failed Merchant 360° reads are presented as unavailable/partial rather than empty or zero business state.
- A missing Pix pricing rule is not mislabeled as an explicitly configured no-minimum/no-maximum rule.
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
- The canonical Railway preview remains configured for the Phase 3 branch and remains read-only.
- If the Railway connector cannot advance the canonical preview from a cached source snapshot, exact-head runtime validation may use an isolated read-only Railway service built from a Docker image pinned to the exact Git SHA. Secrets must remain runtime references and must not be embedded in that image.
- `/healthz` passes and reports preview read-only mode.
- `/app/`, `/app/platform/finance` and a Merchant 360° SPA route load.
- A safe mutation probe is rejected by preview middleware with HTTP 423 `preview_read_only`.
- Railway production service `flash-pag` remains bound to `feat/minimal-pix-gateway` before and after validation.

## Verification history

Earlier checkpoints established the branch/runtime validation pattern and verified health, SPA fallback, backend read-only enforcement, complete tenant inventory reads, zero-Organization merchant membership and exact Organization counts.

Exact-image checkpoint `dd630ade7984eb445dc1aa7097ccdfd38b253644` was built from a pinned Git SHA with frontend read-only mode enabled and deployed to isolated Railway service `flash-pag-phase3-dd630-preview`. Railway deployment `24c05e4c-a2aa-4089-87e5-6d9a67c37062` succeeded. An external GitHub-hosted probe confirmed:
- `/healthz` HTTP 200 with `preview_read_only:true`.
- `/app/`, Financeiro and Merchant 360° SPA routes HTTP 200.
- harmless mutation probe HTTP 423 `preview_read_only`.
- production remained on `feat/minimal-pix-gateway`.

A static finance/product audit after that checkpoint found and corrected three additional correctness classes: mixed browser/UTC financial date boundaries, non-successful `fee_minor` displayed as row revenue, and failed Merchant 360° reads/missing pricing rules being visually ambiguous with real empty/unconfigured state.

The documentation reconciliation following those fixes creates a newer final candidate head. That candidate must pass exact-head CI and the same pinned-image Railway runtime gate before being reported as the latest technical checkpoint.

Phase 3 intentionally remains IN PROGRESS. Authenticated visual/product acceptance is still required before changing status to COMPLETE. The Opera Browser Connector is currently disconnected and no admin test credential is stored in the repository, so that gate is not bypassed by fabricating a session or mutating Supabase Auth.

## Definition of phase completion

Phase 3 may move from IN PROGRESS to COMPLETE only when all acceptance criteria above are verified for the final intended head, authenticated product/visual acceptance is complete, and the permanent documentation (`PROJECT_STATE`, `ROADMAP`, `DECISIONS`, this phase document, and relevant RUNBOOK instructions) matches the validated final state.
