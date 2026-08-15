# Reverlo

Reverlo is a Cloudflare Worker + D1 reputation profile. Public pages show only approved reviews and administrator-configured social profiles. The `/admin` page and every `/api/admin/*` endpoint are protected by Cloudflare Access.

## Review links

Reviews are submitted exclusively through a secure, one-time link generated in `/admin`:

1. Enter the product/deal and optionally preselect a platform.
2. Send the generated `/review/<token>` link to the buyer.
3. The submission API reads the product/deal from D1, not from the browser.
4. A single atomic D1 batch creates the pending review and marks the link as used. Concurrent submissions cannot create two reviews from one link.

`/createreview` and `POST /api/reviews` are intentionally disabled.

## D1 migrations

The existing production database binding must remain `DB → reverlo-db`.

The original schema was initialized from SQL files. Apply only the migrations that are newer than your live database; all are additive and do not delete or reset data:

```powershell
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0001_mysterious_cammi.sql
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0002_ebay_feedback.sql
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0003_ebay_feedback_role.sql
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0004_review_deal_types.sql
```

For a local D1 verification database:

```powershell
npx wrangler d1 execute reverlo-db --local --file=drizzle/0001_mysterious_cammi.sql
npx wrangler d1 execute reverlo-db --local --file=drizzle/0002_ebay_feedback.sql
npx wrangler d1 execute reverlo-db --local --file=drizzle/0003_ebay_feedback_role.sql
npx wrangler d1 execute reverlo-db --local --file=drizzle/0004_review_deal_types.sql
```

`drizzle/0002_ebay_feedback.sql` adds an eBay cache, a locally-hidden state, and sync metadata. `drizzle/0003_ebay_feedback_role.sql` adds a seller/buyer role and defaults the existing imported feedback to `SELLER`. `drizzle/0004_review_deal_types.sql` adds the nullable Sale/Purchase type to review links and Reverlo reviews, preserving existing reviews as unclassified. None of these migrations delete existing reviews, review links, or social profiles. If `0002` and `0003` have already run in production, apply only `0004`.

## eBay seller- and buyer-feedback sync

The Worker calls eBay's Trading API `GetFeedback` server-side using `FeedbackReceivedAsSeller` and `FeedbackReceivedAsBuyer`; browser code receives only cached D1 data. Configure these Worker secrets (never put them in source or frontend variables):

```powershell
npx wrangler secret put EBAY_CLIENT_ID --name YOUR_WORKER_NAME
npx wrangler secret put EBAY_CLIENT_SECRET --name YOUR_WORKER_NAME
npx wrangler secret put EBAY_REFRESH_TOKEN --name YOUR_WORKER_NAME
```

Also configure non-secret Worker variables in the Cloudflare dashboard (or your deployment configuration): `EBAY_ENVIRONMENT=production`, `EBAY_SITE_ID=0` (or your eBay marketplace site ID), and optionally `EBAY_COMPATIBILITY_LEVEL=1423`. The configured cron trigger runs at minute 0 every sixth hour in UTC. The `/api/admin/ebay` endpoint is protected by the existing `/api/admin/*` Cloudflare Access policy.

## Cloudflare Access

Keep `/admin` protected. Ensure `/api/admin/*` has the same Cloudflare Access application/policy. Do not protect `/review/*` or the public profile, because buyers need to open their issued review links.

## Run locally

```powershell
npm install
npm run dev
```

Run a production build with:

```powershell
npm run build
```
