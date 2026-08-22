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

## Private reselling tracker

The private `/track` workspace starts with the dedicated `tracker_products` and `tracker_transactions` tables introduced by `drizzle/0005_private_reselling_tracker.sql`. Money is stored as integer øre and tracker records do not share tables with public reviews, review links, social profiles, or imported eBay feedback.

Apply the tracker migration only after confirming the live database is already current through `0004`:

```powershell
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0005_private_reselling_tracker.sql
```

Expenses, recurring subscription definitions, and actual subscription payment history are added separately by `drizzle/0007_tracker_expenses_subscriptions.sql`. Subscription costs are informational forecasts; only rows in `tracker_subscription_payments` count as Operating Expenses.

```powershell
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0007_tracker_expenses_subscriptions.sql
```

Tracker V2 VAT metadata, editable transaction notes, exact entered prices, and the VAT settlement ledger are added by the next additive migration. Existing transaction VAT fields remain `NULL` until they are explicitly classified.

```powershell
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0008_tracker_vat_and_transaction_editing.sql
```

Cloudflare Access must protect both `/track*` and `/api/track/*`. The tracker deliberately has no application-level login and is not linked from the public profile or included in the sitemap.

### One-off ResellTrack import

`scripts/import-reselltrack.mjs` validates a legacy ResellTrack JSON export and is always a dry run unless `--apply` and an explicit D1 target are provided. It imports inventory products, one purchase transaction per product, linked sales, ordinary expenses, subscriptions, and actual subscription payment history. Explicit, internally reconciling VAT metadata is preserved for future imports; absent or ambiguous VAT remains unknown. Revolut transfers and other unsupported account data remain outside the import.

Run the report without writing to D1:

```powershell
npm run tracker:import -- C:\path\to\reselltrack-data.json
```

Before a first real import, apply the additive import-ledger and expense migrations after `0005`:

```powershell
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0006_tracker_import_ledger.sql
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0007_tracker_expenses_subscriptions.sql
```

The validated report prints a canonical SHA-256 value. A real import requires that exact value as an acknowledgement:

```powershell
npm run tracker:import -- C:\path\to\reselltrack-data.json --apply --remote --confirm SHA256_FROM_DRY_RUN
```

The import uses deterministic product and transaction IDs plus the unique source hash in `tracker_imports`. Reapplying the same export, or another export containing the same legacy record IDs, is rejected instead of duplicating data. Any critical validation issue blocks the complete import.

The already-imported Starlink Mini history must not be imported again. After `0008`, first validate its exact source records with the dedicated dry-run repair:

```powershell
npm run tracker:repair-starlink-vat -- C:\path\to\reselltrack-data.json
```

Only after reviewing its confirmation hash can the guarded metadata-only repair be run explicitly. The repair leaves cost basis, revenue, trading profit, inventory, and operating expenses unchanged:

```powershell
npm run tracker:repair-starlink-vat -- C:\path\to\reselltrack-data.json --apply --remote --confirm HASH_FROM_DRY_RUN
```

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
