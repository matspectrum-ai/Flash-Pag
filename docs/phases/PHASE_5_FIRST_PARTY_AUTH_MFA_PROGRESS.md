# First-party MFA implementation boundary

The first-party Go authentication migration now has the core MFA path wired through the application boundary and protected by an explicit browser-origin check on first-party authentication mutations.

Implemented in this phase:

- encrypted TOTP secret persistence using the existing AES-GCM cryptobox;
- RFC 6238-compatible provisioning and verification primitives;
- replay state persisted as the accepted TOTP timestep;
- atomic PostgreSQL TOTP consumption plus AAL1 -> AAL2 session elevation;
- first-party MFA HTTP endpoints for status, enrollment, enrollment verification, and step-up;
- first-party session middleware that preserves user identity and assurance level;
- recent-MFA freshness enforcement for first-party AAL2 middleware consumers;
- startup wiring that requires PostgreSQL and the 32-byte application master key when first-party auth is enabled;
- disposable PostgreSQL CI infrastructure with a concurrency test executing migrations `0019` and `0021` against real PostgreSQL;
- explicit same-origin protection for first-party cookie-authenticated mutations, with `SameSite=Lax` remaining in force.

The critical financial authorization boundary is still staged. Existing /console and /v1 financial routes continue to use the legacy authentication middleware until the first-party identity migration is complete. A future cutover must require recent AAL2 for sensitive financial effects and preserve the existing KYC, idempotency, payment-lifecycle, and ledger invariants.

Current remaining gates before merge/cutover:

1. Green CI on the exact final head.
2. First-party recovery and membership/authorization migration.
3. Existing-user migration/re-enrollment for password and TOTP because Supabase Auth secrets are not application-readable.
4. Integration of first-party AAL2/recent-MFA authorization into the eventual financial/configuration cutover.
5. Frontend auth cutover from E-mail to User, preserving `DESIGN.md` exactly except for the identifier change.
6. Removal of runtime dependencies on Supabase Auth only after the staged migration and re-enrollment path are proven.
7. Final production cutover validation without changing the current production authentication behavior during development.
