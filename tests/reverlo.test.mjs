import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("review links are server-controlled, one-time, and preserve their deal type", async () => {
  const [submitRoute, legacyRoute, migration, dealTypeMigration, linksRoute] = await Promise.all([
    source("app/api/review/[token]/route.ts"),
    source("app/api/reviews/route.ts"),
    source("drizzle/0001_mysterious_cammi.sql"),
    source("drizzle/0004_review_deal_types.sql"),
    source("app/api/admin/review-links/route.ts"),
  ]);

  assert.match(submitRoute, /env\.DB\.batch/);
  assert.match(submitRoute, /review_links\.product_deal/);
  assert.match(submitRoute, /used_at IS NULL/);
  assert.match(legacyRoute, /status: 410/);
  assert.match(migration, /CREATE TABLE `review_links`/);
  assert.match(migration, /CREATE TABLE `social_profiles`/);
  assert.doesNotMatch(migration, /DROP TABLE/i);
  assert.match(dealTypeMigration, /ALTER TABLE `review_links` ADD `deal_type`/);
  assert.match(dealTypeMigration, /ALTER TABLE `reviews` ADD `deal_type`/);
  assert.doesNotMatch(dealTypeMigration, /DROP TABLE|DELETE FROM/i);
  assert.match(linksRoute, /payload\.dealType === "SALE" \|\| payload\.dealType === "PURCHASE"/);
  assert.match(submitRoute, /review_links\.deal_type/);
});

test("admin uses same-origin protected API routes and public branding is Reverlo", async () => {
  const [admin, layout, home, reviewsRoute, ebayRoute] = await Promise.all([
    source("app/admin/page.tsx"), source("app/layout.tsx"), source("app/page.tsx"), source("app/api/admin/reviews/route.ts"), source("app/api/admin/ebay/route.ts"),
  ]);

  assert.match(admin, /"\/api\/admin\/review-links"/);
  assert.match(admin, /"\/api\/admin\/socials"/);
  assert.match(admin, /"\/api\/admin\/ebay"/);
  assert.doesNotMatch(admin, /fetch\("https?:\/\//);
  assert.match(layout, /Reverlo/);
  assert.match(home, /Official socials/);
  assert.doesNotMatch(`${layout}\n${home}`, /Robert Tacchini|Completed deals/i);
  assert.doesNotMatch(home, /Only profiles configured by Reverlo|Only reviews approved by Reverlo/);
  assert.match(reviewsRoute, /export async function DELETE/);
  assert.match(reviewsRoute, /UPDATE ebay_feedback SET hidden_at/);
  assert.match(reviewsRoute, /SELECT \* FROM \(/);
  assert.match(ebayRoute, /getEbaySyncStatus\(env\.DB, configured\(\)\)/);
});

test("eBay seller and buyer feedback sync is server-side, rated, paginated, and additive", async () => {
  const [ebay, migration, roleMigration, worker, vite, publicList, publicReviews, admin] = await Promise.all([
    source("lib/ebay-feedback.ts"), source("drizzle/0002_ebay_feedback.sql"), source("drizzle/0003_ebay_feedback_role.sql"), source("worker/index.ts"), source("vite.config.ts"), source("app/PublicReviewList.tsx"), source("db/reviews.ts"), source("app/admin/page.tsx"),
  ]);
  assert.match(ebay, /FeedbackReceivedAsSeller/);
  assert.match(ebay, /FeedbackReceivedAsBuyer/);
  assert.match(ebay, /for \(const role of \["SELLER", "BUYER"\] as const\)/);
  assert.match(ebay, /entry\.role\.toLowerCase\(\) !== role\.toLowerCase\(\)/);
  assert.match(ebay, /for \(let page = 2; page <= pages/);
  assert.match(ebay, /ON CONFLICT\(ebay_feedback_id\)/);
  assert.match(migration, /CREATE UNIQUE INDEX `ebay_feedback_source_id_unique`/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/i);
  assert.match(roleMigration, /ALTER TABLE `ebay_feedback` ADD `feedback_role`/);
  assert.match(roleMigration, /DEFAULT 'SELLER'/);
  assert.doesNotMatch(roleMigration, /DROP TABLE|DELETE FROM/i);
  assert.match(publicList, /label: "Sales"/);
  assert.match(publicList, /label: "Purchases"/);
  assert.doesNotMatch(publicList, /label: "Reverlo"|label: "eBay Seller"|label: "eBay Buyer"/);
  assert.match(publicList, /review\.source === "EBAY"/);
  assert.match(publicList, /transactionType\(review\) === "SALE"/);
  assert.match(publicReviews, /when 'positive' then 5/);
  assert.match(publicReviews, /when 'neutral' then 3/);
  assert.match(publicReviews, /when 'negative' then 1/);
  assert.match(publicReviews, /ratingTotal/);
  assert.match(publicReviews, /ratingCount/);
  assert.match(admin, /Seller feedback:/);
  assert.match(admin, /Buyer feedback:/);
  assert.match(vite, /crons: \["0 \*\/6 \* \* \*"\]/);
  assert.match(worker, /scheduled\(/);
  assert.doesNotMatch(ebay, /console\.log/);
});
