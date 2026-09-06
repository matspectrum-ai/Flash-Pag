# Phase 1 — Merchant Onboarding + KYC/KYB

Status: COMPLETE.

## Goal

Establish merchant-level onboarding and verification so real provider connections and financial operations can be gated by an auditable KYC/KYB state rather than by UI convention alone.

## Delivered scope

- Merchant-level KYC/KYB profile.
- Legal/company identity fields and representative data.
- Required-document model with private Supabase Storage.
- Document type, version, current-version tracking, status and admin feedback.
- Merchant submission flow.
- Platform-admin review queue and detail view.
- Review start, needs-changes, approval and rejection decisions.
- KYC event/review history.
- Legacy merchant grandfathering during initial migration so existing beta accounts remained operable.
- KYC gating around provider connection creation and real financial operations.
- Authentication/authorization enforced server-side.

## Persistence

Primary migrations:
- `migrations/0004_kyc_onboarding.sql`
- `migrations/0005_kyc_invariants.sql`
- `migrations/0006_kyc_indexes.sql`

Main tables include:
- `merchant_kyc_profiles`
- `merchant_kyc_documents`
- `merchant_kyc_reviews`
- `merchant_kyc_events`

The `merchant-kyc` Storage bucket is private. Documents are served through authenticated backend proxies rather than direct public Storage URLs.

## Key invariants

- KYC belongs to a Merchant, not to individual Organizations.
- Only valid state transitions are accepted.
- Required documents must satisfy the configured submission rules.
- Document version/current flags preserve historical evidence instead of overwriting uploads silently.
- Provider onboarding and relevant real-money operations are blocked until the merchant is approved.
- Platform review actions are privileged and auditable.

## Main application surfaces

Merchant:
- `/app/kyc` — verification profile, documents and submission flow.

Platform admin:
- `/app/platform/kyc` — global KYC queue and review workflow.

Private API families:
- `/console/api/kyc*`
- `/console/api/admin/kyc*`

## Verification evidence encoded in repository

- KYC handler tests.
- KYC gate logic.
- KYC schema invariants and indexes.
- Platform-admin and merchant UI surfaces.

## Phase exit

Phase 1 is considered complete because the durable KYC/KYB lifecycle, server-side gating, admin review workflow, private-document handling and hardening migrations are present in the current codebase. Later phases may display KYC data (for example Merchant 360°) but must not redefine the lifecycle without an explicit new decision.
