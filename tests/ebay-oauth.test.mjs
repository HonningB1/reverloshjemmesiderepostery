import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthorizationUrl, parseAuthorizationRedirect, upsertEnvValue } from "../scripts/ebay-oauth.mjs";

test("Production authorization URL contains encoded RuName, scopes, and state", () => {
  const url = new URL(buildAuthorizationUrl({ clientId: "client id", ruName: "My RuName", state: "safe-state" }));
  assert.equal(url.origin, "https://auth.ebay.com");
  assert.equal(url.searchParams.get("client_id"), "client id");
  assert.equal(url.searchParams.get("redirect_uri"), "My RuName");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "safe-state");
  assert.equal(url.searchParams.get("scope"), "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.reputation.readonly");
});

test("redirect parsing requires the matching OAuth state", () => {
  assert.equal(parseAuthorizationRedirect("https://example.invalid/callback?code=code-value&state=expected", "expected"), "code-value");
  assert.throws(() => parseAuthorizationRedirect("https://example.invalid/callback?code=code-value&state=wrong", "expected"), /state did not match/);
});

test("local refresh token storage replaces instead of duplicating a value", () => {
  const updated = upsertEnvValue("EBAY_CLIENT_ID=local\nEBAY_REFRESH_TOKEN=old\n", "EBAY_REFRESH_TOKEN", "new");
  assert.equal(updated, "EBAY_CLIENT_ID=local\nEBAY_REFRESH_TOKEN=new\n");
});
