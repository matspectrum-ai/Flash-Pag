# First-party MFA implementation boundary

The first-party Go authentication migration now has the core MFA path wired through the application boundary.

Implemented in this phase:

- encrypted TOTP secret persistence using the existing AES-GCM cryptobox;
- RFC 6238-compatible provisioning and verification primitives;
- replay state persisted as the accepted TOTP timestep;
- atomic PostgreSQL TOTP consumption plus AAL1 -> AAL2 session elevation;
- first-party MFA HTTP endpoints for status, enrollment, enrollment verification, and step-up;
- first-party session middleware that preserves user identity and assurance level;
- startup wiring that requires PostgreSQL and the 32-byte application master key when first-party auth is enabled;
- HTTP and service tests for first-party session state and MFA boundary behavior.

The critical financial authorization boundary is still staged. Existing /console and /v1 financial routes continue to use the legacy authentication middleware until the first-party identity migration is complete. A future cutover must require recent AAL2 for sensitive financial effects and preserve the existing KYC, idempotency, payment-lifecycle, and ledger invariants.

Remaining gates before merge/cutover:

1. Green CI on the exact final head.
2. Real PostgreSQL integration tests for migration 0021, including concurrent replay attempts against the same session/code.
3. Recent-MFA freshness enforcement, rather than treating any historical AAL2 on a 24-hour session as sufficient for critical actions.
4. Origin/CSRF hardening for cookie-authenticated state-changing endpoints.
5. First-party recovery and membership/authorization migration.
6. Frontend auth cutover from E-mail to User, preserving `DESIGN.md` exactly except for the identifier change.
7. Removal of runtime dependencies on Supabase Auth only after the staged migration and user re-enrollment path are proven.
