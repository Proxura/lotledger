# LotLedger

Recall-ready batch and lot records for small makers, with one-click Pirate Ship shipping.
Cloudflare Pages + Pages Functions + D1. No build step. Free tiers only; Stripe per transaction.

## Run locally

```
npm ci
npx wrangler d1 migrations apply lotledger-db --local
npx wrangler pages dev public --compatibility-date=2026-10-01
```

Then open http://localhost:8788/app/#signup.

## Tests

```
npx tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
```

## Deploy (first time)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → this repo.
   Build command: none. Output directory: `public`.
2. D1 → Create database `lotledger-db`. Put its id in `wrangler.jsonc` and commit.
   In the Pages project → Settings → Bindings → add D1 binding `DB` → `lotledger-db`.
3. Apply the schema once: `npx wrangler d1 migrations apply lotledger-db --remote`
   (or paste `migrations/0001_init.sql` into the D1 console).
4. Secrets (Pages project → Settings → Environment variables):
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_LIFETIME`, `STRIPE_PRICE_MONTHLY`, `APP_URL`.
   Stripe webhook endpoint: `https://<site>/api/billing/webhook`, events
   `checkout.session.completed` and `customer.subscription.deleted`.

Every push to `main` deploys.

## Layout

- `public/` the landing page and the app (`/app/`)
- `functions/api/` the API: auth, products, lots, orders, exports, billing, backup
- `migrations/` D1 schema
- `tests/` unit tests for the CSV mapping and the Pirate Ship export
