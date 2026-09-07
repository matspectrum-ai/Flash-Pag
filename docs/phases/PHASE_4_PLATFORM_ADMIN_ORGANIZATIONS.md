# Phase 4 — Platform Admin centered on Organizations

Status: IN PROGRESS.

Development branch: `feat/platform-admin-organizations`.

Baseline: Phase 3 completion head `aa137ea239e1dededc994c7484dd77cd91c21c71`.

## Goal

Replace the infrastructure-oriented admin information architecture with an operational payment-platform control plane. Platform operators manage Organizations/Commercial Accounts; `Merchant` remains an internal tenant boundary and is not a first-class navigation concept.

## Product model

User-visible platform concepts:
- Organization: commercial account/tenant operated by the platform admin.
- User: person with access to one or more commercial-account memberships.
- Transaction: Pix activity belonging to an Organization.
- Balance: Organization-scoped liquidity/account state.
- Processor: provider connection used by one or more Organizations.
- KYC/KYB and Pricing: commercial-account policies resolved internally through the Merchant boundary.

Internal-only concept:
- Merchant remains the durable commercial tenant boundary for membership, KYC/KYB and pricing.
- Existing `merchant_id` relationships and invariants are preserved.
- The UI resolves Organization -> Merchant only when calling existing backend contracts.

## Information architecture

Platform admin navigation:
- Dashboard
- Organizations
- Users
- Transactions
- Balances
- Processors
- KYC
- Pricing

The merchant/operator application remains separate. When the current route is `/platform/*`, the sidebar and mobile navigation show the platform control plane only. The Organization switcher used by the merchant application is not shown in global platform context.

## Organization provisioning

The platform exposes one user-facing action: `New organization`.

Backend provisioning creates, in order:
1. Internal Merchant/commercial-account boundary.
2. Optional owner membership.
3. Organization.
4. Default BRL account.

Existing database triggers automatically initialize:
- KYC/KYB draft profile and initial event.
- Pricing v1/current pricing.

Provisioning is implemented by migration `0010_platform_organization_provisioning.sql` through service-role RPC `provision_platform_organization`. Merchant creation, optional owner assignment, Organization creation and principal BRL account creation execute in one PostgreSQL transaction. Existing Merchant triggers initialize KYC and pricing inside that same transaction. Any failure aborts the transaction; the application does not attempt a best-effort compensating delete.

The old separate `New merchant` and `New organization under merchant` workflow is not part of the new admin UX. Legacy backend endpoints may remain for compatibility but the Phase 4 UI does not expose them.

## Dashboard

`/platform` is the global dashboard and reuses the financially-correct Phase 3 aggregation semantics:
- TPV: successful `pix_in` volume.
- Flash Pag revenue: frozen `fee_minor` realized on success only.
- Provider cost: verified provider-specific evidence only.
- Margin: revenue minus provider cost only with complete cost coverage.
- Financial business calendar: `America/Sao_Paulo`.

Ranking and drill-down are Organization-centric rather than Merchant-centric.

## Organizations

`/platform/organizations` is the primary platform tenant directory.

For each Organization the UI can show, using existing contracts:
- status;
- KYC status inherited from its commercial-account boundary;
- active processors;
- 30-day TPV;
- available balance;
- current Pix pricing;
- creation time.

`/platform/organizations/:organizationId` is Organization 360° and shows:
- financial metrics;
- KYC/KYB;
- Pix pricing;
- balance and accounts;
- exact customer/account/provider-connection counts;
- processor connections;
- users/members;
- recent Pix activity.

## Users

`/platform/users` is based on Merchant memberships resolved back to Organization names. The current backend does not expose global Auth metadata such as email-verification state or last login; the UI must not invent these fields.

## Transactions

`/platform/transactions` is a global read-only Pix audit surface. Revenue is displayed only for successful Pix; pending/failed/ambiguous rows do not realize revenue.

## Balances

`/platform/balances` aggregates Organization-scoped summary/account reads. A failed balance read is unavailable, not zero. Global totals sum only confirmed available values.

## Processors

`/platform/processors` aggregates installed provider adapters and Organization provider connections. Phase 4 does not invent routing latency, approval rate or availability metrics because no dedicated telemetry contract exists yet.

Provider orchestration/health scoring is a later dedicated capability.

## Explicit exclusions

- Do not rename database `merchant` tables/columns merely to match UI vocabulary.
- Do not migrate KYC/pricing/membership away from Merchant scope in this phase.
- Do not add withdrawal UI to the merchant product.
- Do not add fake reconciliation, logs, processor-health, conversion or routing metrics without backend contracts.
- Do not touch Railway production `flash-pag` during implementation or preview validation.

## Acceptance criteria

- `/platform` is Dashboard, not a generic provisioning page.
- Platform sidebar does not expose `Administração`, `Financeiro`, `Merchant 360°` or `Novo merchant` as operator concepts.
- Organization is the first-class tenant list and drill-down entry point.
- Platform routes have their own desktop/mobile navigation context.
- Global platform pages do not show the merchant Organization switcher.
- New Organization is one user-facing provisioning action.
- Provisioning is atomic: a downstream failure aborts the PostgreSQL transaction and leaves no intentionally-created partial tenant state.
- KYC/Pricing UIs select or display Organizations while resolving Merchant IDs internally.
- Users/Transactions/Balances/Processors display only facts available from current backend contracts.
- Existing Phase 3 financial semantics remain unchanged.
- Transferências and Saques remain absent from merchant navigation.
- `gofmt`, TypeScript build, Go tests and `go vet` are green.
- Exact branch head passes CI and read-only preview/runtime validation before Phase 4 is marked COMPLETE.
- Production remains on `feat/minimal-pix-gateway`.
