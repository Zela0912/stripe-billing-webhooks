# CLAUDE.md

Guidance for Claude (and any other contributor) working in this repository.

## What this is

Stripe subscription billing for a fictional SaaS (TidyShift): Checkout, the Customer Portal, and a webhook pipeline that stays correct under duplicate, late and out-of-order events. It is a **portfolio project shown to Upwork clients**. The README, the tests and the failure handling are part of the product.

## Working with Luka

- Talk to Luka in **Croatian**. Code, comments, commit messages, README and UI text are in **English**.
- Go step by step. When a decision matters (architecture, a dependency, a trade-off), explain it in one or two sentences that Luka could repeat to a client.
- Ask before anything outward-facing or hard to undo: pushing, creating or changing the GitHub repo, deploying, creating webhook endpoints, paid services, deleting data.
- Never ask Luka to paste a key into the chat. Keys live only in `.env` (git-ignored). Never print a key or a webhook secret to the terminal.

## Commands

```bash
npm run stripe:setup        # idempotent: products, prices, portal config, local webhook secret → .env
npm run stripe:check-key    # tries every operation with the key in .env.production.local, names missing permissions
npm run dev                 # API :3002 + web :5174 (Vite proxies /api) + `stripe listen` forwarding
npm run check               # lint + typecheck + test + build. Must pass before every commit
npm test                    # Vitest, server + web, offline (fake Stripe API, real signatures)
npm run format              # Biome: format + organise imports
```

## Architecture in one breath

`shared/billing.ts` holds the plan catalog and the API types. A webhook goes `routes/webhooks.ts` (verify signature on the raw body → insert into `webhook_events` → 200) → `webhooks/queue.ts` (serial, durable, retries with backoff) → `webhooks/handlers.ts` (re-read the subscription from Stripe, upsert, send deduplicated emails). `billing/access.ts` is the only place that turns a subscription into plan + access level. The web app (`web/src`) polls `/api/dashboard` and renders it.

## Rules

### TypeScript and runtime

- Node runs `.ts` files directly (type stripping). Use **erasable syntax only**: no `enum`, `namespace` or constructor parameter properties. Import with explicit `.ts` extensions, and use `import type` for types.
- TypeScript 7, Biome for lint and formatting. `strict` is on; no `any`, no non-null assertions.

### Stripe

- Only `billing/stripe-gateway.ts`, `webhooks/verify.ts`, `index.ts` and `scripts/` import the Stripe SDK at runtime. Everything else uses the `BillingGateway` interface or `import type`.
- **Webhook handlers must be idempotent and order-independent.** Never copy subscription state from an event payload; re-read it through the gateway. Key side effects (emails, anything external) on the business object (`invoice id + attempt`), not on the event id.
- The webhook route must do nothing slow before responding. New work goes in a handler, which runs in the queue.
- Refer to prices by **lookup key** (`shared/billing.ts`), never by price id. Change prices in `shared/billing.ts` and rerun `npm run stripe:setup`.
- Every Stripe object this app creates on behalf of a user gets an idempotency key or a deterministic id.
- Access decisions live in `billing/access.ts` only. Add a test there for every status rule.
- Before relying on Stripe behaviour (event names, API fields, limits, test cards), check docs.stripe.com and note the date. The SDK pins API version `2026-10-28.endive`. Billing periods are on subscription **items** (since 2025-03-31), and an invoice's subscription is at `invoice.parent.subscription_details.subscription`.

### Quality bar

- Tests run offline and free: use `server/test/helpers.ts` (`FakeGateway`, `stripeEvent`, signed `deliver`). Never call the real Stripe API from `npm test`.
- When a bug is found in manual or browser testing, add a test that would have caught it.
- UI changes must work in light and dark mode, at 390 px width, by keyboard alone, and with reduced motion.
- Verify flows end to end against the sandbox (`npm run dev`, test card 4242…, demo controls) before claiming they work.

### Security and privacy

- Never log card data, keys or webhook secrets. Log event ids, types, outcomes, attempts and timings.
- `DEMO_MODE` must stay refused with live keys (`config.ts`).
- Users can only see and act on their own workspace (checked in `routes/billing.ts`).
- Never commit secrets. Before committing, check that `git status` doesn't list `.env*` or `data/*.db`.

### Git

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`). Keep commits small and focused, and explain the reason in the body.
- `npm run check` must pass before every commit.
