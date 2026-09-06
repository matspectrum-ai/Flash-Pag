# Flash Pag

Minimal multi-provider Pix gateway: no products, no checkout, no catalog.

## Scope

- REST Pix API + public OpenAPI/Swagger docs
- balance (`available`, `reserved`, `total`)
- Pix charge creation/status
- transfers and withdrawals to Pix keys
- customers
- outbound merchant webhooks with HMAC + durable retry
- provider callback ingestion
- provider adapters as Go plugins/interfaces
- multiple merchants -> multiple organizations -> multiple accounts
- dashboard + platform admin panel
- Supabase Postgres + Auth

## Stack

One Go 1.24 binary, standard library only. Supabase Postgres provides durable state and transactional RPCs; Supabase Auth handles dashboard identity. The dashboard is embedded HTML/CSS/vanilla JS. No Node runtime, ORM, Redis, queue service, microservices, product/checkout subsystem, or floating-point money.

## Financial invariants

Amounts are integer BRL centavos. The ledger is immutable and double-entry per journal. `pix_in` credits `available` only after provider success. `transfer`/`withdrawal` atomically move `available -> reserved` before the provider call; success moves `reserved -> clearing`, final failure releases `reserved -> available`, and ambiguous provider outcomes keep funds reserved.

`Idempotency-Key` is mandatory for financial POSTs. A key is scoped by organization + operation and bound to a semantic request fingerprint.

## Local setup

1. Create a separate Supabase project for Flash Pag (do not reuse Swiftpay).
2. Apply `migrations/0001_init.sql`.
3. Create a Supabase Auth user for the platform admin.
4. Bootstrap that user once:

```sql
insert into public.platform_admins(user_id, role)
select id, 'super_admin' from auth.users where email = 'YOUR_EMAIL';
```

5. Copy `.env.example` to `.env`, fill the Supabase URL/keys, and generate `APP_MASTER_KEY_B64`:

```bash
openssl rand -base64 32
```

6. Run:

```bash
set -a; source .env; set +a
go run ./cmd/flashpag
```

Open `http://localhost:8080/docs` for the public API docs and `http://localhost:8080/console/` for the dashboard/admin.

## First provider

The repository ships with `mock`, a deterministic development adapter. It does not emit a real Pix EMV QR code. A live PSP adapter implements only:

- `CreateCharge`
- `CreateTransfer`
- `VerifyWebhook`

Credentials are stored per organization encrypted with AES-256-GCM under `APP_MASTER_KEY_B64`; plaintext secrets are never returned by list endpoints.

## Webhook signature

Outbound webhooks include:

- `X-FlashPag-Event-Id`
- `X-FlashPag-Timestamp`
- `X-FlashPag-Signature: v1=<hex-hmac-sha256>`

The signed message is `<timestamp>.<raw_body>`.

## REST examples

```bash
curl -H 'X-API-Key: fp_live_...' http://localhost:8080/v1/balance
```

```bash
curl -X POST http://localhost:8080/v1/pix/charges \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: fp_live_...' \
  -H 'Idempotency-Key: order-123' \
  -d '{"amount_minor":1050,"provider":"mock","description":"Teste"}'
```

## Current MVP boundary

This is deliberately not a banking core. There is no checkout, product catalog, fee engine, card acquiring, KYC workflow, settlement file parser, reconciliation UI, automatic provider routing, or multi-currency accounting. Provider-specific production semantics must be encoded and tested per adapter before live money is enabled.
