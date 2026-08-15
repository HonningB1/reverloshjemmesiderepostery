import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("review links are server-controlled and one-time", async () => {
  const [submitRoute, legacyRoute, migration] = await Promise.all([
    source("app/api/review/[token]/route.ts"),
    source("app/api/reviews/route.ts"),
    source("drizzle/0001_mysterious_cammi.sql"),
  ]);

  assert.match(submitRoute, /env\.DB\.batch/);
  assert.match(submitRoute, /review_links\.product_deal/);
  assert.match(submitRoute, /used_at IS NULL/);
  assert.match(legacyRoute, /status: 410/);
  assert.match(migration, /CREATE TABLE `review_links`/);
  assert.match(migration, /CREATE TABLE `social_profiles`/);
  assert.doesNotMatch(migration, /DROP TABLE/i);
});

test("admin uses same-origin protected API routes and public branding is Reverlo", async () => {
  const [admin, layout, home] = await Promise.all([
    source("app/admin/page.tsx"), source("app/layout.tsx"), source("app/page.tsx"),
  ]);

  assert.match(admin, /"\/api\/admin\/review-links"/);
  assert.match(admin, /"\/api\/admin\/socials"/);
  assert.doesNotMatch(admin, /fetch\("https?:\/\//);
  assert.match(layout, /Reverlo/);
  assert.match(home, /Official socials/);
  assert.doesNotMatch(`${layout}\n${home}`, /Robert Tacchini|Completed deals/i);
});
