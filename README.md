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
- provider health checks and read-only reconciliation
- multiple merchants -> multiple organizations -> multiple accounts
- dashboard + platform admin panel
- merchant KYC/KYB lifecycle and platform review
- versioned merchant pricing with immutable transaction fee snapshots
- Supabase Postgres + Auth

## Stack

One Go 1.24 binary, standard library only. Supabase Postgres provides durable state and transactional RPCs; Supabase Auth handles dashboard identity. The React dashboard is built at image-build time and embedded in the Go binary. No Node runtime is required in the final container. There is no ORM, Redis, queue service, microservices, product/checkout subsystem, or floating-point money.

## Financial invariants

Amounts are integer BRL centavos. The ledger is immutable and double-entry per journal. `pix_in` credits `available` only after provider success. `transfer`/`withdrawal` atomically move `available -> reserved` before the provider call; success moves `reserved -> clearing`, final failure releases `reserved -> available`, and ambiguous provider outcomes keep funds reserved.

`Idempotency-Key` is mandatory for financial POSTs. A key is scoped by organization + operation and bound to a semantic request fingerprint.

Reconciliation is read-only at the PSP: Flash Pag looks up the existing provider external ID and then applies the returned status to the local ledger. It never creates another charge or another PIX OUT during reconciliation.

Merchant pricing is versioned. Each transaction freezes the pricing version and exact `fee_minor` used when it is created; historical pricing is immutable.

## Local setup

1. Create a separate Supabase project for Flash Pag (do not reuse Swiftpay).
2. Apply the migrations in numeric order.
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

Open `http://localhost:8080/docs` for the public API docs and `http://localhost:8080/app/` for the React dashboard/admin.

## Providers

The repository includes two adapters:

- `mock`: deterministic development adapter; never moves real money.
- `pixhub`: live Pixhub API v1 adapter for PIX IN, PIX OUT, balance health checks, reconciliation and authenticated provider callbacks.

Provider credentials are stored per organization encrypted with AES-256-GCM under `APP_MASTER_KEY_B64`; plaintext secrets are never returned by list endpoints and must never be committed to Git.

### Pixhub

Create a provider connection from the app under **Conexões** using credentials in this shape:

```json
{
  "client_id": "YOUR_PIXHUB_CLIENT_ID",
  "client_secret": "YOUR_PIXHUB_CLIENT_SECRET"
}
```

Flash Pag automatically adds a random encrypted `webhook_token` to the connection. It is appended to the Pixhub `postbackUrl` and validated on callback as a fallback authentication mechanism. If a registered Pixhub webhook provides `PixHub-Signature`, the adapter validates the documented HMAC-SHA256 signature using an optional `webhook_secret` stored in the same encrypted credentials object.

Pixhub PIX IN requires payer CPF/CNPJ, so create the customer first and pass its `customer_id` when creating a charge. The adapter infers `cpf` or `cnpj` from the normalized document length.

Pixhub PIX OUT receives the Flash Pag transaction UUID as `x-idempotency-key`, preventing the PSP operation from being duplicated on safe retries.

In **Conexões**, `Testar` authenticates against Pixhub and calls only `GET /api/v1/balance`. The response is converted from Pixhub's decimal-real strings to exact integer centavos without floating-point arithmetic.

In **Transações**, `Reconciliar` is available for Pixhub transactions that are `pending` or `ambiguous`. It queries the existing Pixhub transaction/transfer ID; success settles the local ledger, a final PIX OUT failure releases reserved funds, and an intermediate PSP state remains pending.

Example customer:

```bash
curl -X POST http://localhost:8080/v1/customers \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: fp_live_...' \
  -d '{"name":"Cliente Teste","document":"12345678901","email":"cliente@example.com"}'
```

Example real Pixhub charge:

```bash
curl -X POST http://localhost:8080/v1/pix/charges \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: fp_live_...' \
  -H 'Idempotency-Key: order-123' \
  -d '{"amount_minor":1050,"provider":"pixhub","customer_id":"CUSTOMER_UUID","description":"Pagamento"}'
```

The returned `qr_code` is the real EMV Pix copy-and-paste string received from Pixhub. The full provider response is retained internally in `provider_payload` for operational evidence.

## Webhook signature

Outbound merchant webhooks include:

- `X-FlashPag-Event-Id`
- `X-FlashPag-Timestamp`
- `X-FlashPag-Signature: v1=<hex-hmac-sha256>`

The signed message is `<timestamp>.<raw_body>`.

Provider callbacks are separate from merchant callbacks. For Pixhub, Flash Pag accepts either the documented `PixHub-Signature` HMAC when `webhook_secret` is configured, or the encrypted per-connection callback token used in the `postbackUrl`.

## REST examples

```bash
curl -H 'X-API-Key: fp_live_...' http://localhost:8080/v1/balance
```

Development-only mock charge:

```bash
curl -X POST http://localhost:8080/v1/pix/charges \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: fp_live_...' \
  -H 'Idempotency-Key: order-dev-123' \
  -d '{"amount_minor":1050,"provider":"mock","description":"Teste"}'
```

## Current MVP boundary

This is deliberately not a banking core. There is no checkout, product catalog, card acquiring, settlement file parser, automatic provider routing, or multi-currency accounting. KYC/KYB and merchant fee pricing are already implemented in the current branch.

Pixhub `transaction_refunded` events are persisted as provider evidence but do not yet post a compensating reversal journal. Refund/reversal ledgering remains a financial-core hardening item and is not the primary scope of Phase 3.
