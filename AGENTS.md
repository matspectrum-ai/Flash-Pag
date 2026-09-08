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
- Do not expose raw provider payloads to browser clients.
- Product UI scope is phase-controlled: do not reintroduce Transferências in the merchant panel; Saques remain deferred until their explicitly approved phase.

## Architecture
Observe -> validate/auth -> claim idempotency -> persist local intent/reservation -> call provider -> persist provider evidence -> project financial state -> enqueue outbound webhook -> respond.

Providers implement `internal/provider.Provider`. Do not put provider-specific branching in the core handlers.

Prefer existing durable contracts and read models before adding schema. Add a migration only when a required invariant or historical fact cannot be represented correctly with existing persistence.

## Permanent project documentation

The repository documentation is a source of truth and must be kept synchronized with implementation:
- `docs/PROJECT_STATE.md` — current factual state, active phase, deployment separation and open validation.
- `docs/ROADMAP.md` — agreed phase order, scope and release gates.
- `docs/DECISIONS.md` — durable product/architecture decisions and guardrails.
- `docs/RUNBOOK.md` — development, CI, preview and deployment procedures.
- `docs/phases/` — per-phase requirements, retrospective, acceptance criteria and completion state.

Do not rely on chat history as the only record of a decision. When implementation changes any documented fact, phase status, invariant, deployment procedure, guardrail or acceptance criterion, update the relevant documentation in the same workstream.

## Verification
Run `gofmt`, `go test ./...`, `go vet ./...`. For frontend changes, run the TypeScript/Vite production build used by CI. For schema changes, apply them to a disposable Supabase project/branch, run security and performance advisors, then exercise the affected RPCs with success, duplicate, insufficient-balance, and illegal-transition cases.

A green result from an older commit does not validate the current head. Always verify the exact commit intended for preview/release.

## Definition of Done

A substantial feature or phase is not Done until all applicable items are true:
1. Requirements and guardrails are implemented without silently broadening product scope.
2. Relevant unit/integration tests cover observable behavior and financial invariants.
3. `gofmt`, `go test ./...`, `go vet ./...` and frontend production build pass.
4. GitHub CI is green on the exact final branch head.
5. For UI/runtime phases, the exact head is deployed to the designated read-only Railway preview and health/application behavior is validated.
6. Production remains unchanged unless an explicit production deployment was separately requested and approved.
7. `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/RUNBOOK.md` and the relevant file under `docs/phases/` are reviewed and updated to match reality.
8. Only after these gates may a phase status be changed to COMPLETE.
