First-party MFA is now wired through the Go service, PostgreSQL store, HTTP boundary, and startup configuration.

The supported first-party flow is: authenticated AAL1 session -> TOTP enrollment/status -> enrollment verification -> atomic TOTP consumption and AAL2 elevation. TOTP secrets are encrypted at rest with the application AES-GCM cryptobox and are never returned from persistence APIs.

The AAL2 result is an authentication assurance signal, not standalone authorization for financial effects. The eventual financial-action middleware must additionally enforce the existing merchant/KYC, scope, idempotency, payment-lifecycle, and ledger invariants.

The remaining hard gates are PostgreSQL concurrency integration tests, recent-MFA freshness, CSRF/Origin controls for cookie-authenticated mutations, recovery/membership migration, and the final frontend/runtime cutover from Supabase Auth to first-party Go auth.
