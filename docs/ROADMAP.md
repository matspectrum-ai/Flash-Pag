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

Status: IN PROGRESS.

Required outcome:
- Global platform financial dashboard.
- Global metrics with strict semantics:
  - TPV = successful processed `pix_in` volume for the selected period.
  - Flash Pag revenue = fees charged.
  - Provider cost = real provider cost supported by explicit evidence.
  - Margin = revenue − provider cost only when provider cost coverage is complete.
  - No net-profit metric until all remaining cost categories are modeled.
- Time-series / charts for platform financial activity.
- Global Pix transaction view across organizations.
- Merchant ranking / drill-down.
- Merchant 360° containing complete operational context for the merchant and all organizations, including KYC/KYB, current pricing, members, accounts/balances, customers, provider connections and recent Pix activity.
- Platform-admin-only access to global/merchant-wide information.
- No raw provider payload exposure to the browser.

Explicit exclusions:
- Do not reintroduce Transferências in the merchant panel.
- Saques remain deferred to their dedicated future phase.
- Refund/reversal ledgering may be hardened if necessary but does not replace Phase 3.

Release gate:
1. Implementation complete on `feat/admin-finance-merchant-360`.
2. CI green on the exact branch head.
3. Only `flash-pag-react-preview` is switched to the Phase 3 development branch.
4. Preview deployment succeeds.
5. `/healthz`, application routes and preview read-only behavior are validated.
6. Production `flash-pag` remains on its stable branch and is not changed.

Detailed working plan: `docs/phases/PHASE_3_ADMIN_FINANCE_MERCHANT_360.md`.

## Later phases

The exact order after Phase 3 must be explicitly agreed before implementation. Known backlog items include:
- Dedicated withdrawal product/UI phase.
- Refund/reversal compensating ledger journals and related hardening.
- Broader provider-cost normalization if provider contracts expose trustworthy fee data.
- Additional operational/admin controls as separately specified.

No backlog item above may be promoted into the current phase implicitly.
