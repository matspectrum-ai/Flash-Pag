# Flash Pag engineering rules

This is a financial system. Prefer small, verifiable changes over broad abstractions.

## Invariants
- BRL amounts use integer centavos (`int64` / PostgreSQL `bigint`). Never use floating point for money.
- Ledger entries are immutable. Corrections are new journals/reversals.
- Every committed journal must sum to zero.
- Outbound Pix reserves available balance before contacting a provider.
- A provider timeout is ambiguous, not failed. Keep the same operation/provider identity and reconcile before retrying.
- Financial POST endpoints require `Idempotency-Key`; same-key/different-input reuse is an error.
- Provider webhooks are untrusted until adapter-specific signature verification succeeds.
- Never log API keys, provider credentials, webhook secrets, Pix keys/documents unnecessarily, or raw secret-bearing provider payloads.

## Architecture
Observe -> validate/auth -> claim idempotency -> persist local intent/reservation -> call provider -> persist provider evidence -> project financial state -> enqueue outbound webhook -> respond.

Providers implement `internal/provider.Provider`. Do not put provider-specific branching in the core handlers.

## Verification
Run `gofmt`, `go test ./...`, `go vet ./...`. For schema changes, apply them to a disposable Supabase project/branch, run security and performance advisors, then exercise the affected RPCs with success, duplicate, insufficient-balance, and illegal-transition cases.
