# First-party MFA implementation boundary

This slice adds encrypted TOTP secret persistence through the existing AES-GCM cryptobox, atomic timestep consumption, and AAL2 session elevation primitives.

The HTTP MFA endpoints are intentionally not exposed yet. Before exposure, code consumption and session elevation should be transactionally coupled where practical, and PostgreSQL integration tests must cover concurrent replay attempts.
