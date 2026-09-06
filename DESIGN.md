# Flash Pag Design System

Status: active design specification for the beta console.

## 1. Product direction

Flash Pag is a financial operating system for Pix. The interface must feel closer to a modern business banking console than to a generic SaaS admin template.

The primary structural reference is the current Revolut Business product language: financial information first, dense but calm layouts, strong hierarchy, contextual actions, progressive disclosure, modular dashboard surfaces, and fast navigation for repeated operational work.

This document does **not** instruct the product to copy Revolut branding, proprietary illustrations, typography, icons, or exact color palette. Flash Pag keeps its own identity while adopting the interaction and information-design principles that fit a B2B fintech.

## 2. Core principles

### 2.1 Money first

On financial screens, hierarchy is:

1. balance / amount;
2. state / risk;
3. primary action;
4. counterparty / provider / account;
5. technical metadata.

Do not give IDs, labels or explanatory copy more visual weight than the money state they describe.

### 2.2 Operational density without ERP noise

The console is used repeatedly, not read like a marketing page.

- Prefer tables for financial history.
- Prefer drawers for investigation.
- Prefer compact inline filters.
- Avoid giant cards for data that belongs in rows.
- Use whitespace to separate tasks, not to artificially inflate every component.

### 2.3 Progressive disclosure

The overview should answer "what needs attention?". The detail view should answer "what exactly happened?".

Technical values such as provider IDs, transaction UUIDs, scopes and webhook signatures remain available, but are secondary until the user opens the relevant detail surface.

### 2.4 Contextual actions

Place actions where the user understands their financial consequence.

Examples:

- reconcile inside the transaction detail;
- health test inside the provider card;
- transfer action close to balance context;
- API key creation inside developer/integration context;
- organization switching in the application shell.

### 2.5 Safety in financial UI

The UI must make irreversible or ambiguous states explicit.

- `pending` and `ambiguous` are never visually equivalent to success;
- reserved balance must never be presented as available;
- external PSP balance must never be presented as Flash Pag ledger balance;
- retries on financial operations must preserve idempotency;
- destructive actions require confirmation once those actions are exposed in the console.

## 3. Brand adaptation

### 3.1 Brand character

Flash Pag should feel:

- fast;
- precise;
- modern;
- neutral;
- financially credible;
- developer-friendly.

Avoid playful fintech clichés, neon gradients across entire screens, oversized glass cards, excessive iconography, and generic AI-dashboard visuals.

### 3.2 Accent color

Use one product accent rather than a rainbow UI.

Temporary beta token:

- `--fp-accent: #5b5cff`
- `--fp-accent-hover: #4c4de7`
- `--fp-accent-soft: #eeeeff`

This token is deliberately separate from Revolut branding and can be replaced later without changing component structure.

Semantic colors remain independent from the brand accent.

## 4. Foundation tokens

### 4.1 Neutral palette

```css
--fp-bg: #f7f7f8;
--fp-surface: #ffffff;
--fp-surface-subtle: #fafafa;
--fp-surface-strong: #111114;
--fp-text: #151518;
--fp-text-secondary: #65656d;
--fp-text-tertiary: #92929b;
--fp-border: #e8e8eb;
--fp-border-strong: #d9d9de;
```

### 4.2 Semantic palette

```css
--fp-success: #087a55;
--fp-success-bg: #eaf8f2;
--fp-warning: #96620b;
--fp-warning-bg: #fff7df;
--fp-danger: #b4232a;
--fp-danger-bg: #fff0f1;
--fp-info: #3159b8;
--fp-info-bg: #eef3ff;
```

Semantic colors must indicate state, not decoration.

### 4.3 Spacing scale

Base unit: 4px.

```text
4   micro
8   compact
12  control gap
16  component gap
20  compact panel padding
24  standard panel padding
32  section separation
40  page-level separation
```

Do not invent arbitrary spacing values unless the component requires optical correction.

### 4.4 Radius

```text
8px   compact controls
10px  buttons / inputs
12px  small cards
16px  primary panels
20px  hero surfaces
999px pills only
```

Rounded corners must not dominate the interface.

### 4.5 Shadows

Borders are preferred over shadows.

Use shadow only for elevated transient layers:

- drawers;
- menus;
- modals;
- floating notifications.

Cards inside the normal page flow should usually use a 1px border and no shadow.

## 5. Typography

Use the system/Inter-compatible stack already shipped by the application.

Hierarchy:

- Page title: 28–32px, 700–760
- Financial hero amount: 34–44px, 720–780
- Section title: 15–17px, 650–720
- Card metric: 22–28px, 700–760
- Body: 12–14px
- Metadata: 10–12px
- Mono values: 10–12px

Rules:

- monetary amounts use tabular numerals when possible;
- labels use normal sentence case;
- uppercase is reserved for tiny eyebrow/navigation labels;
- never use display-sized typography inside operational tables.

## 6. Application shell

### 6.1 Sidebar

Desktop target width: 236–248px.

The sidebar should:

- remain visually quieter than page content;
- group navigation by task domain;
- show clear current-view state;
- expose user/session context at the bottom;
- avoid strong separators between every item.

Navigation groups:

1. Visão geral
   - Dashboard
2. Operação
   - Transações
   - Transferências
   - Clientes
3. Desenvolvedores
   - Integrações
   - API & Docs
   - Webhooks
4. Estrutura
   - Contas
   - Organizações
5. Plataforma
   - Administração (platform admin only)

### 6.2 Topbar

The topbar carries context, not decoration.

It contains:

- small product/beta eyebrow;
- page title;
- one-line page purpose;
- tenant/organization context;
- organization switcher.

Do not add global actions here unless they are truly cross-product actions.

### 6.3 Content width

Desktop page content should remain readable on wide screens.

- max content width: approximately 1480px;
- page gutter: 32–40px desktop;
- 20–24px tablet;
- 14–16px mobile.

## 7. Component system

### 7.1 Financial hero

Used for the most important balance or account state.

Contains:

- account label;
- available amount;
- secondary reserved/clearing information;
- nearby contextual actions;
- minimal metadata.

A hero is not a generic metric card enlarged with CSS.

### 7.2 Metric cards

Use for short operational questions:

- received volume;
- sent volume;
- success rate;
- pending operations;
- provider health.

Metric cards should be compact, flat, and comparable.

### 7.3 Tables

Tables are the primary financial-history component.

Requirements:

- clear header hierarchy;
- compact row height;
- amount aligned consistently;
- status represented with restrained badges;
- row click opens detail drawer;
- filters above table;
- pagination below table;
- technical IDs abbreviated in rows but complete/copyable in detail.

### 7.4 Drawers

Use for detailed investigation without losing list context.

Transaction drawer should contain:

1. type + amount + status;
2. lifecycle/status progression;
3. counterparty/customer data;
4. provider data;
5. timestamps;
6. technical identifiers;
7. contextual actions such as reconcile.

### 7.5 Forms

Financial and credential forms must be explicit.

- labels always visible;
- examples in placeholders only;
- helper text explains consequence, not obvious field mechanics;
- primary action anchored consistently;
- secrets use password input;
- generated secrets are shown once with copy action.

### 7.6 Status badges

Status badge text must use human Portuguese labels.

Financial states:

- succeeded -> Concluída
- pending -> Pendente
- ambiguous -> Ambígua
- failed -> Falhou

Infrastructure states:

- active -> Ativa
- disabled -> Desativada
- blocked -> Bloqueada

### 7.7 Empty/loading/error states

Empty state:

- say what is absent;
- explain what normally appears there;
- add action only when a real next action exists.

Loading state:

- use skeletons that match page structure;
- do not replace the entire application shell.

Error state:

- concise problem description;
- retry action when safe;
- do not expose secrets/internal stack traces.

## 8. Dashboard information architecture

The Dashboard is an operational home, not a report gallery.

Recommended hierarchy:

### Row 1 — Financial state

- available balance hero;
- reserved balance/context;
- primary transfer action;
- account identity.

### Row 2 — Operational metrics

- Pix received (7d);
- Pix sent (7d);
- success rate;
- pending/ambiguous count.

### Row 3 — Activity

- 7-day volume visualization;
- status distribution / exceptions.

### Row 4 — Operational health

- provider health;
- integration state;
- organization/merchant context.

### Row 5 — Recent transactions

Dense table with row-to-drawer interaction.

The dashboard must make exceptions visible. A healthy zero-state should be quieter than a pending/ambiguous state.

## 9. Page-specific rules

### 9.1 Transactions

Primary jobs:

- find an operation;
- understand state;
- reconcile if needed;
- copy identifiers.

Use a dense table and a detail drawer. Do not create separate full pages for every transaction in the beta unless deep-linking becomes necessary.

### 9.2 Transfers

Primary jobs:

- understand available funds;
- create Pix out / withdrawal;
- verify provider and connection;
- review prior outgoing operations.

Keep the financial consequence close to the submit action.

### 9.3 Customers

Primary jobs:

- find payer;
- create payer;
- inspect payer history.

Customer detail should emphasize transaction history, not CRM-style fields that Flash Pag does not use.

### 9.4 Integrations

Separate two concepts visually:

- PSP/provider connections;
- merchant API credentials.

Never render raw credential JSON in the final UI.

### 9.5 API & Docs

Treat this as a developer workspace:

- Base URL;
- authentication;
- idempotency;
- scopes;
- quick endpoint reference;
- link to full OpenAPI docs.

### 9.6 Webhooks

Show endpoint identity, subscribed events and delivery state.

When backend delivery logs are exposed, add:

- latest HTTP code;
- attempt count;
- next retry;
- delivery timeline.

### 9.7 Accounts

Flash Pag internal ledger balance is primary.

Provider balance is secondary external context and must be labelled explicitly as external PSP balance.

### 9.8 Organizations

Organization switch must visibly change tenant context. Avoid any interaction that makes different organizations appear merged.

### 9.9 Platform admin

Admin is a separate operating mode, not just another merchant page.

Hierarchy:

1. platform overview;
2. merchants;
3. organizations;
4. members / RBAC;
5. provider/integration oversight when backend supports it.

## 10. Responsive behavior

Desktop is the primary operational target, but mobile must remain usable.

### >= 1200px

- full sidebar;
- 4-column metrics;
- 2-column analysis panels;
- table-first histories.

### 900–1199px

- 2-column metrics;
- reduced gutters;
- panels collapse where necessary.

### < 900px

- sidebar becomes compact top/navigation area using current beta mechanism;
- one-column content for forms and detail-heavy panels;
- drawers become full-screen.

### < 620px

- single-column metric cards;
- filters stack;
- action buttons can become full width;
- tables remain horizontally scrollable rather than destroying column meaning.

## 11. Motion

Motion is functional only.

Allowed:

- 120–180ms hover/focus transitions;
- 180–240ms drawer enter/exit;
- subtle chart/bar transitions;
- skeleton loading shimmer.

Avoid bouncing cards, continuous decorative animation and parallax.

Honor `prefers-reduced-motion`.

## 12. Accessibility baseline

- keyboard-visible focus state on every actionable control;
- drawer closes with Escape;
- status is communicated by text, not color only;
- minimum practical hit target around 36px for compact desktop actions;
- body text should remain readable at 100% zoom;
- contrast must meet normal UI expectations;
- tables retain semantic table markup.

## 13. Implementation order

### Phase A — Foundation

- CSS tokens
- typography
- spacing
- buttons
- inputs
- badges
- panels
- tables
- focus/motion behavior

### Phase B — Shell

- sidebar
- topbar
- organization switcher
- user session block
- responsive navigation

### Phase C — Dashboard

- financial hero
- metrics
- activity visualization
- provider health
- recent transactions

### Phase D — Core operation

- transactions
- transfers
- customers

### Phase E — Developer surfaces

- integrations
- API & Docs
- webhooks

### Phase F — Structure / admin

- accounts
- organizations
- platform admin

## 14. Definition of done for the visual pass

A page is not considered visually migrated merely because it has new colors.

It is done when:

- hierarchy follows this document;
- layout is consistent with the shell;
- all states have deliberate styling;
- actions are contextual;
- technical data is progressively disclosed;
- mobile behavior remains functional;
- no raw development-only control remains visible;
- no backend contract was silently changed just to satisfy the visual design.
