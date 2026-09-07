# Flash Pag — Runbook

Operational guide for development, validation and deployment. This document is intentionally conservative because Flash Pag is a financial system.

## Repository and branches

Repository: `matspectrum-ai/Flash-Pag`.

Stable production branch currently used by Railway `flash-pag`:
- `feat/minimal-pix-gateway`

Completed Phase 3 branch:
- `feat/admin-finance-merchant-360`

Current Phase 4 development branch:
- `feat/platform-admin-organizations`

Previous React integration branch used by preview before Phase 3:
- `feat/react-console`

Do not move production to a development branch as part of normal phase validation.

## Local verification

Backend formatting and verification:

```bash
gofmt -w ./cmd ./internal
go test ./...
go vet ./...
```

Frontend verification:

```bash
cd web
npm install --no-audit --no-fund
npm run build
```

The frontend build runs TypeScript checking through the repository build script before Vite production bundling.

Container-equivalent verification is also exercised by the Docker/Railway build, which builds the React bundle, runs Go tests and compiles the final Go binary.

## CI gate

Workflow: `.github/workflows/ci.yml`.

Before promoting a development head to preview:
1. Identify the exact branch head SHA.
2. Confirm GitHub Actions/check status for that SHA.
3. Do not treat a green status from an older SHA as validation of the current head.
4. If CI fails, fix the branch first; do not work around the failure by deploying production.
5. Documentation updates are commits too; after final documentation changes, re-run/confirm CI on the new exact head.

## Database changes

For any new migration:
1. Use the next numeric migration file; never edit an already-applied migration to change history.
2. Apply to a disposable Supabase project/branch first.
3. Run Supabase security/performance advisors.
4. Exercise affected RPCs and invariants including success, duplicate/idempotent behavior, insufficient balance where applicable, invalid state transitions and authorization boundaries.
5. Confirm backward compatibility with existing merchants/organizations or document an explicit migration strategy.
6. Only after verification may a migration be considered ready for a real environment.

Phase 3 required no new migration. Phase 4 adds `0010_platform_organization_provisioning.sql` only for the durable atomic-provisioning invariant. The Organization-centric information architecture remains an application-layer refactor over the existing tenant model; the new RPC must be applied and tested in staging before any writable Phase 4 environment is enabled.

## Railway services

Project: `Flash Pag Beta`.

### Production

Service: `flash-pag`.

Expected source:
- Repo: `matspectrum-ai/Flash-Pag`
- Branch: `feat/minimal-pix-gateway`
- Healthcheck: `/healthz`

Production must remain unchanged while a development phase is being implemented or validated.

### Development preview

Service: `flash-pag-react-preview`.

Expected Phase 3 source after CI gate:
- Repo: `matspectrum-ai/Flash-Pag`
- Branch: `feat/admin-finance-merchant-360`
- Healthcheck: `/healthz`

Read-only guards that must remain configured:
- `APP_PREVIEW_READ_ONLY=true`
- `VITE_PREVIEW_READ_ONLY=true`

The preview may read the shared beta backing data needed for validation because mutations are blocked at both backend middleware and UI layers. Do not remove either guard during normal validation.

### Exact-head image fallback

If the Railway connector reports the correct source branch but repeatedly redeploys an older cached source snapshot, do not move production and do not claim the branch head was validated.

Use an isolated read-only Railway service built from a Docker image pinned to the exact Git SHA:
1. Confirm CI is green for the target SHA.
2. Build the repository at that exact SHA with Docker build argument `VITE_PREVIEW_READ_ONLY=true`.
3. The image must contain code/static assets only. Never bake Supabase credentials, `APP_MASTER_KEY_B64`, provider credentials or any other runtime secret into the image.
4. Deploy the image to a separate Railway preview service.
5. Configure runtime secrets through Railway reference variables to the existing preview/shared values; do not copy secret plaintext into GitHub or build logs.
6. Configure `APP_PREVIEW_READ_ONLY=true`, `APP_ADDR=:8080`, secure cookies and `/healthz`.
7. Give the isolated service its own Railway preview domain on port 8080 and set `APP_PUBLIC_URL` to that exact isolated domain. Do not inherit a canonical-preview public URL, or authentication redirects may leave the exact-head service.
8. Run the same health, SPA and HTTP 423 probes used for the canonical preview.
9. Record the exact Git SHA, image identity and Railway deployment ID in project state/verification history.
10. Treat temporary external image registries as validation transport only, not long-term production artifact storage.

This fallback validates the exact code artifact without weakening production separation. It does not replace the requirement that the canonical preview configuration remain pointed at the Phase 3 branch.

## Preview promotion procedure

1. Confirm the exact Phase 3 head SHA.
2. Confirm CI is green for that SHA.
3. Re-read `flash-pag` configuration and verify it still points at `feat/minimal-pix-gateway`.
4. Confirm `flash-pag-react-preview` remains configured for `feat/admin-finance-merchant-360`.
5. Trigger/observe only the preview deployment.
6. Confirm Railway deployment metadata reports the exact expected commit SHA and branch. If the connector redeploys an older cached snapshot, stop treating the canonical service as exact-head evidence and use the isolated exact-image fallback above.
7. Confirm build success, including TypeScript/Vite build and Go tests.
8. Confirm `/healthz` succeeds and reports preview read-only mode.
9. Confirm the React app loads through `/app/` and the Phase 3 routes return SPA content.
10. Confirm a harmless mutating POST is rejected with HTTP 423 `preview_read_only` before handler mutation logic.
11. Re-read `flash-pag` configuration after validation and confirm production was not changed.

## Phase 3 admin-read checks

These contracts are platform-admin only and should return HTTP 401 without a session / HTTP 403 for an authenticated non-admin:
- `GET /console/api/admin/tenants`
- `GET /console/api/admin/merchants/{merchantID}/members`
- `GET /console/api/admin/organizations/{organizationID}/stats`

Authenticated acceptance checks:
- Tenant inventory represents all Merchants/Organizations within the configured 10,000-row safety ceiling; if the ceiling is reached, `complete` must be false and the UI must show a warning.
- Merchant membership remains readable when the Merchant has zero Organizations.
- Organization stats use exact PostgREST counts for accounts, customers and provider connections; do not compare against generic bounded list lengths as proof of exactness.
- Per-Organization transaction lists are capped at 1,000 rows for the beta client aggregation. If a list reaches the cap, Admin Financeiro/Merchant 360° must warn that financial totals may be incomplete.
- Failed account, balance, provider-connection, membership, KYC, pricing or transaction reads must render as unavailable/partial rather than as real empty or zero state.

## Phase 3 visual/behavior checks

Admin Financeiro:
- Platform-admin only.
- TPV uses successful `pix_in`; it is not Flash Pag revenue.
- Revenue uses frozen `fee_minor` only after the Pix succeeds. Pending, failed or ambiguous rows must not display their frozen fee as realized revenue.
- 7/30/90-day membership and daily chart buckets use the `America/Sao_Paulo` business calendar.
- Provider cost shows only verified provider-specific cost evidence.
- When provider-cost coverage is incomplete, a known subtotal must be visibly partial/confirmed and must not be presented as a complete zero-cost total.
- Margin is absent/indisponível when provider-cost coverage is incomplete.
- No metric is labeled net profit.
- Transaction row amounts are labeled as values; TPV remains an aggregate concept.
- Global transaction surface does not mix Transferências or Saques into the Phase 3 Pix dashboard.
- Merchant ranking/drill-down uses the dedicated admin tenant inventory, not bounded `/me` arrays.

Merchant 360°:
- Platform-admin only.
- Merchant identity/status visible.
- Zero, one and multiple Organization cases render safely.
- KYC/KYB status and business details visible.
- Current Pix pricing visible.
- A missing Pix rule renders as unconfigured/unknown and is not mislabeled as an explicit “Sem mínimo”/“Sem máximo” rule.
- Merchant members/roles visible independent of Organization existence.
- Organization balance context and account details visible.
- Exact account/customer/provider-connection counts visible by Organization.
- Provider connection details visible by Organization.
- Read failures are visibly unavailable/partial and are not confused with real empty lists.
- Recent Pix activity consolidated across Organizations.
- Row revenue follows the same successful-Pix realization rule as Admin Financeiro.

Merchant panel guardrails:
- Do not add Transferências navigation/page back into the merchant product UI.
- Do not add Saques UI until its dedicated phase.

## Phase 3 completion acceptance

Authenticated visual acceptance completed on 2026-09-06 against exact code checkpoint `2610afd62cc6b41418241514c32f92e8882bb7e9` on isolated Railway service `flash-pag-phase3-final-preview`. The preview remained backend/UI read-only and production remained unchanged.

Accepted behavior included:
- Admin Financeiro 7/30/90 switching and `America/Sao_Paulo` business-calendar presentation.
- TPV, realized Flash Pag revenue, provider cost and margin kept semantically distinct.
- Pending/failed global and Merchant 360° Pix rows rendered `—` for realized revenue/provider cost/margin.
- Merchant 360° KYC, pricing, members, Organization balance/account/customer/connection counts, connection details and recent Pix.
- Responsive desktop/mobile layouts with no Transferências or Saques navigation reintroduced.
- Exact preview authentication staying on the isolated domain after setting its own `APP_PUBLIC_URL`.

Do not fabricate non-admin identities or induce destructive business failures only to repeat acceptance. Authorization/error-state guarantees should be exercised by tests and safe runtime boundary probes unless a legitimate test identity/state already exists.

## Phase 4 platform-admin checks

Information architecture:
- `/platform` is Dashboard.
- `/platform/organizations` is the tenant directory.
- `/platform/organizations/{organizationID}` is Organization 360°.
- `/platform/users`, `/platform/transactions`, `/platform/balances` and `/platform/processors` expose only backend-supported facts.
- Platform desktop/mobile navigation is separate from merchant/operator navigation.
- Global platform routes do not display the merchant Organization switcher.
- No user-facing `New merchant`, Merchant ranking or Merchant 360° navigation remains in the active Phase 4 routes.

Provisioning:
- `POST /console/api/admin/organizations/provision` is platform-admin only.
- Read-only preview must reject it with HTTP 423 before mutation logic.
- The handler creates the hidden Merchant boundary, optional owner membership, Organization and principal BRL account.
- Existing database triggers initialize KYC draft state and pricing v1.
- If a downstream provisioning step fails, the newly-created Merchant is deleted so cascade constraints remove partial Organization/account state.

Product acceptance:
- Organization directory columns and metrics must not silently turn failed reads into zero.
- Organization 360° must preserve successful-Pix revenue realization and provider-cost completeness semantics from Phase 3.
- Pricing selection is by Organization in the UI even though pricing remains merchant-scoped internally.
- KYC presents Organization/commercial-account vocabulary while retaining merchant-scoped backend authorization.
- Users view must not invent Auth fields such as email verification or last login until a dedicated admin contract exists.
- Processors view must not invent latency, availability, approval or routing scores until telemetry contracts exist.

## Incident / rollback rule

If preview validation fails:
- Keep production unchanged.
- Revert/fix the development branch or point the preview back to the last known-good development branch/commit.
- Preserve evidence from CI/build/runtime logs.
- Update `docs/PROJECT_STATE.md` if the failure changes the known project state or next action.

If production ever requires rollback, treat it as a separate explicit production operation; do not infer approval from a preview task.
