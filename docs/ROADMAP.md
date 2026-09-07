# Flash Pag — Roadmap

This roadmap defines phase order and acceptance gates. A later phase must not silently replace the agreed scope of the current phase.

## Phase 1 — Merchant onboarding + KYC/KYB

Status: COMPLETE.

Outcome:
- Merchant onboarding with tenant boundaries.
- KYC/KYB profile lifecycle.
- Required document upload/versioning in private storage.
- Platform-admin review queue, review state and decisions.
- Operational gating for provider connections and financial operations based on KYC approval.
- Audit/history and transition invariants.

Primary schema: migrations `0004`–`0006`.

Detailed retrospective: `docs/phases/PHASE_1_KYC.md`.

## Phase 2 — Pricing / Taxas

Status: COMPLETE.

Outcome:
- Versioned pricing per merchant.
- Rules for supported operation types in the financial core.
- Immutable pricing history.
- Current pricing pointer per merchant.
- Exact pricing version and `fee_minor` frozen on each transaction.
- Platform-admin pricing management UI.
- Merchant transaction UI exposes the frozen fee charged for the transaction.

Primary schema: migrations `0007`–`0009`.

Important: pricing support in the core does not imply that every operation must appear in the merchant panel. Product navigation follows phase-specific UI guardrails.

Detailed retrospective: `docs/phases/PHASE_2_PRICING.md`.

## Phase 3 — Admin Financeiro + Merchant 360°

Status: COMPLETE.

Required outcome:
- Global platform financial dashboard.
- Global metrics with strict semantics:
  - TPV = successful processed `pix_in` volume for the selected period.
  - Flash Pag revenue = frozen `fee_minor` realized only on successful Pix.
  - Provider cost = real provider cost supported by verified provider-specific evidence.
  - Margin = revenue − provider cost only when provider-cost coverage is complete.
  - No net-profit metric until all remaining cost categories are modeled.
- Financial period membership and daily buckets use `America/Sao_Paulo` consistently rather than browser-local or raw UTC calendar boundaries.
- Time-series / charts for platform financial activity.
- Global Pix transaction view across Organizations.
- Merchant ranking / drill-down.
- Global Merchant/Organization inventory that does not silently inherit bounded session/bootstrap limits.
- Merchant 360° containing complete operational context for the merchant and all Organizations, including KYC/KYB, current pricing, members, accounts/balance context, exact customer/account/provider-connection counts, connection details and recent Pix activity.
- Merchants with zero Organizations remain valid Merchant 360° subjects and can still expose merchant-level membership/KYC/pricing.
- Explicit incompleteness indicators whenever safety/read limits are reached.
- Failed administrative reads are shown as unavailable/partial rather than being mislabeled as true empty, zero or unconfigured business state.
- Platform-admin-only access to global/merchant-wide information.
- No raw provider payload exposure to the browser.

Explicit exclusions:
- Do not reintroduce Transferências in the merchant panel.
- Saques remain deferred to their dedicated future phase.
- Refund/reversal ledgering may be hardened if necessary but does not replace Phase 3.

Release gate:
1. Implementation complete on `feat/admin-finance-merchant-360`.
2. Permanent documentation matches the intended head.
3. CI green on that exact branch head.
4. The canonical Railway preview remains configured for the Phase 3 development branch and remains read-only.
5. The exact expected SHA is runtime-validated on Railway. If the connector cannot advance a cached canonical-preview snapshot, an isolated read-only Railway service built from an image pinned to the exact Git SHA is acceptable; secrets must remain runtime references and must not be embedded in the image.
6. `/healthz`, application routes and preview read-only behavior are validated.
7. Production `flash-pag` remains on `feat/minimal-pix-gateway` and is not changed.
8. Phase status changes to COMPLETE only after the agreed authenticated product/visual acceptance is complete.

Detailed working plan: `docs/phases/PHASE_3_ADMIN_FINANCE_MERCHANT_360.md`.

Completion evidence: final code checkpoint `2610afd62cc6b41418241514c32f92e8882bb7e9` passed CI and exact-image read-only Railway validation, followed by authenticated platform-admin visual acceptance of Admin Financeiro and Merchant 360° on desktop/mobile. The final completion documentation commit is docs-only and is revalidated as an exact head per the same gate.

## Phase 4 — Platform Admin centered on Organizations

Status: IN PROGRESS.

Required outcome:
- Replace the generic `Administração`/Merchant-first UI with a payments-operations control plane.
- Organization/Commercial Account is the first-class platform-admin tenant concept.
- `Merchant` remains an internal domain boundary for membership, KYC/KYB and pricing.
- `/platform` becomes the global Dashboard.
- Add Organization directory and Organization 360° drill-down.
- Add truthful global Users, Transactions, Balances and Processors views using existing backend facts.
- KYC and Pricing are presented through Organization context while retaining merchant-scoped backend invariants.
- New Organization is a single provisioning action that creates the hidden Merchant boundary, optional owner membership, Organization and principal BRL account.
- Preserve all Phase 3 financial semantics and merchant-product navigation guardrails.

Explicit exclusions:
- No schema/table rename from Merchant to Organization merely for UX vocabulary.
- No fake processor-health, reconciliation or audit-log metrics without dedicated contracts.
- No withdrawal UI in the merchant panel.

Release gate:
1. Implementation and permanent documentation on `feat/platform-admin-organizations`.
2. TypeScript/Vite build, `gofmt`, `go test ./...` and `go vet ./...` green.
3. CI green on the exact branch head.
4. Read-only preview validates Dashboard, Organizations, Organization 360°, Users, Transactions, Balances, Processors, KYC and Pricing.
5. Provisioning mutation remains rejected with HTTP 423 on read-only preview.
6. Production `flash-pag` remains on `feat/minimal-pix-gateway`.
7. Phase status changes to COMPLETE only after authenticated product/visual acceptance.

Detailed working plan: `docs/phases/PHASE_4_PLATFORM_ADMIN_ORGANIZATIONS.md`.

## Later phases

The exact order after Phase 3 must be explicitly agreed before implementation. Known backlog items include:
- Dedicated withdrawal product/UI phase.
- Refund/reversal compensating ledger journals and related hardening.
- Broader provider-cost normalization if provider contracts expose trustworthy fee data.
- Additional operational/admin controls as separately specified.

No backlog item above may be promoted into the current phase implicitly.
