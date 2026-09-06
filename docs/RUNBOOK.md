# Flash Pag — Runbook

Operational guide for development, validation and deployment. This document is intentionally conservative because Flash Pag is a financial system.

## Repository and branches

Repository: `matspectrum-ai/Flash-Pag`.

Stable production branch currently used by Railway `flash-pag`:
- `feat/minimal-pix-gateway`

Current Phase 3 development branch:
- `feat/admin-finance-merchant-360`

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

Phase 3 currently requires no new migration. Its additional admin completeness logic is implemented as read-only contracts over existing tables/RPCs.

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

## Preview promotion procedure

1. Confirm the exact Phase 3 head SHA.
2. Confirm CI is green for that SHA.
3. Re-read `flash-pag` configuration and verify it still points at `feat/minimal-pix-gateway`.
4. Confirm `flash-pag-react-preview` points at `feat/admin-finance-merchant-360`.
5. Trigger/observe only the preview deployment.
6. Confirm Railway deployment metadata reports the exact expected commit SHA and branch.
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

## Phase 3 visual/behavior checks

Admin Financeiro:
- Platform-admin only.
- TPV uses successful `pix_in`; it is not Flash Pag revenue.
- Revenue uses frozen `fee_minor`.
- Provider cost shows only verified provider-specific cost evidence.
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
- Merchant members/roles visible independent of Organization existence.
- Organization balance context and account details visible.
- Exact account/customer/provider-connection counts visible by Organization.
- Provider connection details visible by Organization.
- Recent Pix activity consolidated across Organizations.

Merchant panel guardrails:
- Do not add Transferências navigation/page back into the merchant product UI.
- Do not add Saques UI until its dedicated phase.

## Incident / rollback rule

If preview validation fails:
- Keep production unchanged.
- Revert/fix the development branch or point the preview back to the last known-good development branch/commit.
- Preserve evidence from CI/build/runtime logs.
- Update `docs/PROJECT_STATE.md` if the failure changes the known project state or next action.

If production ever requires rollback, treat it as a separate explicit production operation; do not infer approval from a preview task.
