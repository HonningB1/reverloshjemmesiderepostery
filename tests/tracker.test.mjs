import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("private tracker uses isolated additive D1 tables and integer øre amounts", async () => {
  const [migration, schema] = await Promise.all([source("drizzle/0005_private_reselling_tracker.sql"), source("db/schema.ts")]);
  assert.match(migration, /CREATE TABLE `tracker_products`/);
  assert.match(migration, /CREATE TABLE `tracker_transactions`/);
  assert.match(migration, /purchase_price_ore/);
  assert.match(migration, /net_profit_ore/);
  assert.match(migration, /CHECK \(`status` IN \('IN_STOCK', 'LISTED', 'RESERVED', 'SOLD'\)\)/);
  assert.match(migration, /idx_tracker_transactions_type_date/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|ALTER TABLE `(?:reviews|review_links|ebay_feedback|social_profiles)`/i);
  assert.match(schema, /trackerProducts = sqliteTable/);
  assert.match(schema, /trackerTransactions = sqliteTable/);
});

test("sales are validated against inventory and update remaining stock in the same D1 batch", async () => {
  const route = await source("app/api/track/transactions/route.ts");
  assert.match(route, /product\.remainingQuantity < quantity/);
  assert.match(route, /db\.batch/);
  assert.match(route, /WHERE id = \? AND remaining_quantity >= \?/);
  assert.match(route, /remaining_quantity = remaining_quantity - \?/);
  assert.match(route, /THEN 'SOLD'/);
  assert.match(route, /cost_basis_ore/);
  assert.match(route, /net_profit_ore/);
});

test("tracker stays private, unlinked and outside the public sitemap", async () => {
  const [layout, tracker, home, sitemap, robots, worker] = await Promise.all([
    source("app/track/layout.tsx"), source("app/track/TrackerApp.tsx"), source("app/page.tsx"),
    source("public/sitemap.xml"), source("public/robots.txt"), source("worker/index.ts"),
  ]);
  assert.match(layout, /index: false/);
  assert.match(layout, /follow: false/);
  assert.match(robots, /Disallow: \/track/);
  assert.doesNotMatch(sitemap, /\/track/);
  assert.doesNotMatch(home, /href=["']\/track/);
  assert.match(worker, /X-Robots-Tag/);
  assert.doesNotMatch(tracker, /\balert\s*\(|\bconfirm\s*\(/);
});

test("tracker APIs are isolated and the calculator does not persist data", async () => {
  const [tracker, overview, inventory, transactions, analytics] = await Promise.all([
    source("app/track/TrackerApp.tsx"), source("app/api/track/overview/route.ts"),
    source("app/api/track/inventory/route.ts"), source("app/api/track/transactions/route.ts"),
    source("app/api/track/analytics/route.ts"),
  ]);
  for (const value of [tracker, overview, inventory, transactions, analytics]) assert.doesNotMatch(value, /api\/admin|ebay_feedback|review_links/);
  assert.match(tracker, /Expected profit/);
  assert.match(tracker, /Break-even price/);
  assert.match(tracker, /Maximum purchase price/);
  assert.doesNotMatch(tracker, /fetch\([^\n]*calculator/);
});
