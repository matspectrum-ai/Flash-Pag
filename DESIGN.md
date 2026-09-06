# Flash Pag Product & UX System

Status: source of truth for the authenticated Flash Pag application.

## 1. Product model

Flash Pag is a B2B Pix financial operating product. The authenticated experience must be organized around the jobs a merchant performs with money, not around database tables, backend packages, or generic SaaS admin conventions.

The product language takes structural inspiration from modern business banking products such as Revolut Business: money first, calm density, strong hierarchy, contextual actions, progressive disclosure, and fast repeated operation. Flash Pag keeps its own brand and interaction model.

`console` is a legacy/technical term only. It may remain in internal API paths during migration, but it is not a user-facing product name. The user-facing application lives under `/app/`.

## 2. Naming rules

Use language that describes the user's task.

Preferred user-facing terms:

- Início — operational home and financial overview.
- Transações — all money movement and Pix lifecycle history.
- Transferências — Pix out and withdrawals.
- Contas — Flash Pag ledger accounts and balances.
- Clientes — payers/counterparties associated with Pix in.
- API Keys — programmatic credentials.
- Webhooks — outbound event subscriptions and delivery health.
- Documentação — API reference and integration guidance.
- Verificação — merchant KYC/KYB and activation state.
- Conexões — PSP/provider connections used by the organization.
- Organização — current company/tenant settings and access context.
- Plataforma — Flash Pag operator area for platform administrators.

Avoid in merchant-facing UI unless technically necessary:

- console;
- tenant;
- merchant ID;
- provider connection JSON;
- raw backend resource names;
- database vocabulary.

`merchant`, `tenant`, `organization_id`, provider codes, UUIDs and similar values remain available in technical detail surfaces when useful, but they are not navigation concepts.

## 3. Information architecture

### Primary navigation

1. Início
2. Dinheiro
   - Transações
   - Transferências
   - Contas
3. Clientes
4. Desenvolvedores
   - API Keys
   - Webhooks
   - Documentação
5. Configurações
   - Verificação
   - Conexões
   - Organização
6. Plataforma — platform administrators only
   - Administração
   - KYC

The organization switcher lives in the application shell and changes the context for all organization-scoped views. Do not duplicate a technical `tenant` card next to it.

KYC/KYB is merchant-level even though it is reached from the selected organization context. Multiple organizations belonging to the same merchant share one verification state.

### Platform mode

Platform administration is a distinct operating mode, not a merchant settings page. It should progressively split into:

- Visão geral;
- Empresas;
- Organizações;
- Membros e permissões;
- KYC/KYB review;
- Conexões/providers oversight;
- operational health.

The merchant application and platform mode may share primitives, but must not visually imply that platform-wide data belongs to the selected organization.

## 4. Core UX principles

### Money first

Financial hierarchy is:

1. amount/balance;
2. state/risk;
3. primary action;
4. counterparty/account;
5. provider/technical metadata.

Reserved money is never shown as available. External PSP balance is never presented as Flash Pag ledger balance.

### Operational density without ERP noise

Use tables for financial history, drawers for investigation, compact filters for repeated work, and whitespace to separate tasks rather than inflate cards.

### Progressive disclosure

Overview answers `what needs attention?`. Detail answers `what exactly happened?`.

IDs, provider references, webhook signatures and scopes appear when relevant, usually in detail drawers or developer surfaces.

Provider choice is hidden from the primary financial flow whenever routing can resolve it safely. The merchant expresses the financial intent; Flash Pag resolves an eligible connection. Provider metadata belongs in advanced controls, investigation and configuration.

### Contextual actions

Examples:

- reconcile inside transaction detail;
- transfer next to available balance;
- provider health action inside a connection detail;
- API key creation inside API Keys;
- webhook test/delivery actions inside Webhooks;
- verification action inside the KYC/KYB status surface.

### Safe financial interaction

- pending and ambiguous are never styled like success;
- financial submissions require review when consequence is material;
- repeatable requests preserve idempotency;
- ambiguous operations are reconciled before retry;
- irreversible/destructive actions require confirmation;
- secrets are shown once and never redisplayed in plaintext;
- `mock` is development infrastructure and is never presented as an implicit production route;
- real PSP operations require approved merchant verification.

## 5. Shell

### Desktop sidebar

Target width: 232–248px. The sidebar groups tasks by user intent and stays visually quieter than the page content.

No duplicated page title inside the page body. The shell owns the page title; page content starts with useful financial/operational information.

### Header

The header contains:

- page title;
- optional concise context/subtitle;
- current organization selector;
- page-level primary action when appropriate;
- user/account menu.

Do not show a separate `Tenant` badge beside the organization selector.

A merchant with incomplete verification receives a persistent but compact account-level warning with a direct route to Verificação. Do not hide KYC state only inside settings.

### Content width

- max: approximately 1480px;
- desktop gutters: 32–40px;
- tablet: 20–24px;
- mobile: 14–16px.

## 6. Financial page patterns

### Início

The home page is an operational command center, not a gallery of reports.

Priority:

1. available balance and account context;
2. money actions;
3. exceptions requiring attention;
4. recent movement;
5. short-period volume/performance;
6. connection health only when relevant.

Avoid showing organization metadata as a full dashboard panel unless it has operational value.

### Transações

Primary jobs:

- find a movement;
- understand state;
- understand amount/direction/counterparty;
- investigate failure or pending state;
- reconcile when needed;
- copy technical references.

Dense table first. Filters are compact. Details open without losing list context. CPF/CNPJ is masked by default and fully exposed only when the user's task requires it.

### Transferências

Primary jobs:

- understand spendable balance;
- enter destination and amount;
- resolve an eligible route without exposing unnecessary PSP complexity;
- review consequence;
- submit once;
- monitor final state.

Routing rules:

- one eligible active real connection: select automatically and keep provider outside the primary form;
- multiple eligible connections: choose through routing policy and expose an override only under Avançado when useful;
- no eligible real connection: block the real operation and direct the merchant to Conexões;
- disabled connections are never eligible;
- `mock` is never a silent fallback for a real operation.

### Contas

Accounts are core financial infrastructure, not generic settings. Show Flash Pag internal balances as primary and external PSP balances as clearly labeled secondary context.

### Clientes

This is payer/counterparty management, not a CRM. Optimize for identifying a payer, creating a valid Pix payer and opening their payment history.

Documents are masked in list views.

## 7. Developer experience

### API Keys

Dedicated surface. Show name, prefix, scopes, created date, last use and state. Secrets are shown exactly once after creation.

### Webhooks

Dedicated surface. Show endpoint, subscribed events, state and delivery health. When backend contracts exist, expose latest response, attempts, next retry and event timeline.

### Documentação

Dedicated developer workspace with:

- base URL;
- authentication;
- idempotency;
- request/response conventions;
- errors;
- endpoint reference;
- OpenAPI link.

### Conexões

Provider/PSP setup belongs in Configurações, not beside API keys. Use provider-friendly names, connection health, environment, capabilities and credential state. Raw credential JSON is never shown.

Disabled connections do not present primary health/test actions as if they were active.

## 8. Organization and tenancy UX

The backend remains multi-merchant and multi-organization. The UI reduces cognitive load:

- organization context is selected once in the shell;
- switching context refreshes every organization-scoped query;
- no data from multiple organizations is visually merged;
- organization settings contain identity/access/configuration, not financial history;
- platform administrators get a separate platform-wide mode;
- merchant-level rules such as KYC/KYB and commercial pricing must not be duplicated independently per organization unless a deliberate override model exists.

## 9. Onboarding and KYC/KYB

Self-registration provisions one coherent commercial account:

```text
auth user
  -> merchant
  -> owner membership
  -> initial organization
  -> default BRL account
  -> merchant KYC/KYB profile
```

Provisioning must be transactional or compensating and retry-safe. A lost network response must not create duplicate merchants, organizations or default accounts. If authentication succeeds but provisioning fails irrecoverably, the backend attempts to roll back the just-created auth identity so the user can retry safely.

KYC/KYB lifecycle:

```text
draft
  -> submitted
  -> under_review
  -> approved
  -> needs_changes
  -> rejected
```

Allowed review transitions are deliberately constrained. Merchant data is editable in `draft`, `needs_changes` and `rejected`, and locked while submitted, under review or approved.

Verification belongs to the merchant, not to an individual organization. Owners and merchant admins can maintain and submit it. Platform administrators review it in a separate platform queue.

Required baseline documents are:

- company articles/constitutive document;
- CNPJ registration proof;
- representative identity document;
- address proof.

Additional ownership, banking or requested supporting documents can be added when required by risk/compliance.

Document rules:

- KYC documents live in a private Storage bucket;
- the browser never receives a public Storage URL;
- upload and download go through authenticated Flash Pag backend routes;
- accepted formats are PDF, JPEG and PNG;
- maximum object size is 15 MB;
- each object stores SHA-256 metadata;
- replacement creates a new document version and preserves history;
- platform-only internal review notes are never exposed to the merchant;
- merchant-visible correction/rejection observations are explicitly separated from internal notes.

Real payment infrastructure is enabled only when merchant KYC/KYB is `approved`. Development-only `mock` behavior can remain available without approval, but it must never masquerade as an eligible real route.

Existing beta merchants introduced before KYC may be grandfathered as approved during the initial migration to preserve the already-running financial operation. New merchants start at `draft`.

## 10. Visual foundation

Flash Pag is dark by foundation, not a light dashboard with inverted background colors. Background, surfaces, elevated layers, borders, typography hierarchy, inputs, tables, drawers, skeletons, badges, state surfaces and authentication all use the same dark system.

The structural reference is modern dark financial software such as Revolut, while visual identity remains Flash Pag.

Avoid generic AI-dashboard aesthetics: excessive gradients, floating glass cards, decorative charts, huge rounded rectangles and oversized empty whitespace. Borders are preferred over shadows; gradients are restrained and only support hierarchy.

Base tokens:

```css
--fp-bg: #08080a;
--fp-bg-soft: #0a0a0c;
--fp-surface: #111114;
--fp-surface-raised: #17171b;
--fp-surface-hover: #1c1c21;
--fp-surface-strong: #202026;
--fp-input: #121216;
--fp-border: #26262c;
--fp-border-strong: #34343c;
--fp-text: #f5f5f7;
--fp-text-secondary: #a1a1aa;
--fp-text-tertiary: #6f6f78;
--fp-accent: #7467ff;
--fp-success: #5bd6a0;
--fp-warning: #f1bd62;
--fp-danger: #ff747e;
```

Semantic color communicates state, not decoration.

Spacing uses a 4px base. Primary panels use 12–16px radius. Shadows are reserved for transient layers such as dialogs/drawers and must remain restrained.

Typography:

- page title: 28–32px;
- financial amount: 34–44px;
- section title: 15–17px;
- body: 13–14px;
- metadata: 11–12px;
- money uses tabular numerals.

Secondary copy must remain readable at normal desktop zoom; do not shrink operational text simply to create visual density.

## 11. Components

Shared primitives must include:

- Button;
- IconButton;
- Input / Select / Checkbox;
- Money;
- StatusBadge;
- Metric;
- Panel;
- DataTable;
- FilterBar;
- Drawer;
- Dialog;
- EmptyState;
- ErrorState;
- Skeleton;
- CopyValue;
- OrganizationSwitcher.

Business components must include:

- BalanceSummary;
- TransactionRow / TransactionDetail;
- TransferComposer / TransferReview;
- CustomerSummary;
- ConnectionCard;
- APIKeyRow;
- WebhookEndpointRow;
- KYCStatus;
- KYCDocument;
- KYCReviewQueue.

## 12. Responsive behavior

Desktop is the primary operational target, but mobile remains first-class for monitoring and basic actions.

- >=1200px: full sidebar, dense tables, multi-column operational panels;
- 900–1199px: reduced gutters and 2-column metrics;
- <900px: compact navigation and one-column detail-heavy layouts;
- <620px: stacked controls, full-screen drawers, horizontally scrollable financial tables where column semantics matter.

Do not transform every desktop table into unrelated mobile cards if that destroys comparison and financial meaning.

KYC forms collapse into a single readable column on narrow screens. Document upload/review controls remain explicit and never rely on hover.

## 13. Accessibility and motion

- visible keyboard focus;
- Escape closes transient layers;
- state is communicated with text, not color alone;
- practical desktop hit target around 36px;
- semantic tables;
- readable 100% zoom;
- 120–180ms interaction transitions;
- 180–240ms drawer/dialog transitions;
- honor `prefers-reduced-motion`.

## 14. React application architecture

User-facing source lives in `web/`.

```text
web/src/
  app/            routing, providers, shell composition
  api/            typed HTTP client and API contracts
  components/     shared visual/business primitives
  features/       feature modules by user job
  hooks/          reusable application hooks
  lib/            formatting, validation and helpers
  styles/         design tokens and global styles
```

Feature modules use product terminology, not backend table names:

```text
features/
  home/
  transactions/
  transfers/
  accounts/
  customers/
  api-keys/
  webhooks/
  docs/
  kyc/
  connections/
  organization/
  platform/
```

Build flow:

```text
React + TypeScript source
        -> Vite build
        -> internal/ui/dist
        -> go:embed
        -> single Flash Pag binary
        -> Railway
```

The existing `/console/api/*` HTTP contracts may remain temporarily as private implementation detail during migration. New user-facing navigation uses `/app/*`.

## 15. Commercial pricing boundary

Merchant pricing is a platform-administered commercial rule, not a global fixed fee and not an organization setting by default.

The pricing implementation belongs to the financial/pricing phase and must support versioned merchant-specific rules and immutable transaction-level pricing snapshots. Editing a merchant's current fee must never rewrite the economics of historical transactions.

## 16. Definition of done

A page or workflow is done only when:

- its navigation name matches the user's job;
- hierarchy starts with money/task state rather than backend metadata;
- loading, empty, error and permission states are deliberate;
- technical detail is progressively disclosed;
- sensitive personal data is masked appropriately;
- actions have clear financial consequence;
- responsive behavior remains usable;
- no raw development-only control remains visible;
- no backend contract was silently weakened for visual convenience;
- authorization and tenant isolation are enforced server-side;
- financially or compliance-sensitive state transitions are testable and auditable.
