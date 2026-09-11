# Phase 5 — First-party Identity and Authentication

Status: IN PROGRESS.

## Objective

Move Flash Pag's runtime identity boundary out of Supabase Auth and into the Go backend, while preserving the existing financial, tenant, KYC/KYB and product-design invariants.

The target user-facing credential is `User + Password`, with TOTP MFA and the offline Recovery Kit as separate security controls. Email may remain as optional business/contact data, but it is not the authentication identifier or a prerequisite for account recovery.

## Target architecture

```text
Browser
  -> Flash Pag Go API
       -> authentication / session / MFA / recovery
       -> authorization / tenant policy
       -> financial domain services
       -> PostgreSQL
```

The React client must not call Supabase Auth directly. The long-term runtime path must not depend on `auth.users`, `auth.sessions` or Supabase Auth endpoints.

Supabase PostgreSQL may remain the database during and after the Auth cutover.

## Staged implementation

### Stage 1 — Foundation

Migration `0017_first_party_auth_foundation.sql` establishes first-party identity, password credential, session, TOTP metadata and authentication evidence tables. Existing Supabase identities are copied into `app_users` with deterministic temporary usernames and compatibility fields.

No runtime authentication behavior is switched by Stage 1.

### Stage 2 — Go authentication

Implemented foundation:
- username normalization and uniqueness;
- password hashing using Argon2id;
- opaque server-side sessions with hashed bearer tokens;
- session revocation and expiry;
- first-party HTTP login, session introspection and logout contracts;
- uniform authentication failure responses to reduce account enumeration;
- PostgreSQL-backed username+IP login throttling;
- explicit Secure cookie configuration for reverse-proxy deployments;
- append-only security evidence schema.

The first-party HTTP path remains opt-in and is not the production authentication path yet.

### Stage 3 — MFA and recovery migration

Implemented MFA foundation:
- migration `0019_first_party_mfa_assurance.sql` adds explicit session assurance (`aal1`/`aal2`) and TOTP factor parameters/replay state;
- migration `0020_first_party_mfa_atomicity.sql` and `0021_first_party_mfa_atomic_step.sql` establish PostgreSQL state-transition functions;
- Go TOTP primitives generate 160-bit secrets, build `otpauth://` provisioning URIs, and verify RFC 6238-compatible SHA-1 codes with a bounded ±1 timestep window;
- TOTP secrets are encrypted at rest through the existing AES-GCM cryptobox and are never returned from persistence APIs;
- first-party HTTP endpoints now expose MFA status, enrollment, enrollment verification and step-up;
- step-up consumes the accepted timestep and elevates the same AAL1 session to AAL2 inside a PostgreSQL atomic operation;
- session introspection carries MFA verification state and recent-MFA freshness is enforced by the first-party AAL2 middleware helper;
- disposable PostgreSQL CI infrastructure is configured and a concurrency test executes the production migration functions against a real PostgreSQL instance;
- first-party authentication mutations enforce same-origin requests when browsers supply the `Origin` header, with `SameSite=Lax` retained on the session cookie;
- migration `0022_first_party_membership_links.sql` adds first-party identity bridges for merchant memberships and platform-admin relationships, backfills them from the existing compatibility mapping, and exposes service-role-only first-party authorization read functions.

Not yet complete:
- first-party recovery migration;
- completion of membership/platform-admin runtime authorization cutover from legacy `auth.users` identifiers;
- integration of first-party AAL2/recent-MFA authorization into the eventual financial/configuration cutover;
- end-to-end account migration/re-enrollment flow for existing users;
- final production cutover validation.

Existing Supabase TOTP secrets must not be extracted. Existing users must enter an explicit re-enrollment path after the cutover. Recovery must be first-party and retain the existing Recovery Kit security model.

### Stage 4 — Domain/user FK migration

Continue the bridge established by migration `0022_first_party_membership_links.sql`: migrate membership and platform-admin runtime reads and writes from `auth.users` identifiers to `app_users` while preserving UUID identity values. Update affected SQL functions and Go data access accordingly. Remove runtime reads from `auth.users` only after dual-path validation is complete.

### Stage 5 — Cutover and cleanup

Cut the runtime session/auth path to first-party Go auth, migrate remaining existing accounts through the compatibility path, then remove temporary `legacy_*` fields and Auth migration contracts.

## Security requirements

- Passwords are never stored plaintext.
- Browser sessions use opaque random tokens; only hashes are persisted.
- TOTP secrets are encrypted at rest by the Go service and never logged.
- Recovery Kit is independent of email and does not authorize financial actions by itself.
- Sensitive financial/configuration mutations continue to require recent MFA/step-up assurance.
- Session revocation is server-enforced, not a frontend convention.
- Authentication errors must not reveal whether a username exists.
- No Supabase Auth secret, access token or refresh token may be exposed to the browser after cutover.

## Product/UI guardrail

Authentication screens continue to follow `DESIGN.md`. The first visual change after the backend cutover is the existing login field label/behavior changing from `E-mail` to `User`; layout, hierarchy, typography, spacing, states, mobile behavior and brand treatment must remain within the established design system.

## Verification gates

Before declaring Phase 5 complete:

1. `gofmt`, `go test ./...`, `go vet ./...` and frontend production build pass.
2. GitHub CI is green on the exact final head.
3. Database migrations are exercised in disposable/staging PostgreSQL before production application.
4. Login, logout, session expiry/revocation, registration, MFA enrollment/verification, step-up, recovery and recovery session invalidation are tested end-to-end.
5. Existing tenant membership, KYC/KYB, API keys and financial authorization semantics remain unchanged.
6. `auth.users`/`auth.sessions` runtime references are absent from the application code before the phase is completed.
7. Production deployment occurs only after the exact head has passed the project release gates.
8. `DESIGN.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md` and this file reflect the actual state.
