#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

const ENV_FILE = ".env.ebay.local";
const PRODUCTION_AUTHORIZE_URL = "https://auth.ebay.com/oauth2/authorize";
const PRODUCTION_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.reputation.readonly",
];

function unquote(value) {
  const trimmed = value.trim();
  return (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1)
    : trimmed;
}

export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = unquote(match[2]);
  }
  return values;
}

async function loadLocalEnv() {
  try {
    const fileValues = parseEnv(await readFile(ENV_FILE, "utf8"));
    for (const [name, value] of Object.entries(fileValues)) {
      if (!process.env[name]) process.env[name] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function requiredConfig(includeRefreshToken = false) {
  const names = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME"];
  if (includeRefreshToken) names.push("EBAY_REFRESH_TOKEN");
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}. Set it in your shell or in ${ENV_FILE}.`);
  }
  return {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    ruName: process.env.EBAY_RUNAME,
    refreshToken: process.env.EBAY_REFRESH_TOKEN,
  };
}

export function buildAuthorizationUrl({ clientId, ruName, state }) {
  const url = new URL(PRODUCTION_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ruName,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
  }).toString();
  return url.toString();
}

export function parseAuthorizationRedirect(value, expectedState) {
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error("Paste the complete redirect URL from eBay, including both code and state."); }
  const error = url.searchParams.get("error");
  if (error) throw new Error(`eBay authorization was not completed: ${error}.`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw new Error("The redirect URL did not include both code and state.");
  if (state !== expectedState) throw new Error("OAuth state did not match. Start the authorization flow again.");
  return code;
}

function basicAuthorization(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

function responseError(payload, status) {
  const error = typeof payload?.error === "string" ? payload.error : "token_request_failed";
  const description = typeof payload?.error_description === "string" ? `: ${payload.error_description.slice(0, 240)}` : "";
  return new Error(`eBay token request failed (${status}) — ${error}${description}`);
}

async function tokenRequest({ clientId, clientSecret, body }) {
  const response = await fetch(PRODUCTION_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuthorization(clientId, clientSecret), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError(payload, response.status);
  if (typeof payload.refresh_token !== "string" && body.grant_type === "authorization_code") throw new Error("eBay did not return a refresh token.");
  if (typeof payload.access_token !== "string") throw new Error("eBay did not return an access token.");
  return payload;
}

export async function exchangeAuthorizationCode({ clientId, clientSecret, ruName, code }) {
  return tokenRequest({ clientId, clientSecret, body: { grant_type: "authorization_code", code, redirect_uri: ruName } });
}

export async function verifyRefreshToken({ clientId, clientSecret, refreshToken }) {
  return tokenRequest({ clientId, clientSecret, body: { grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPES.join(" ") } });
}

export function expiryText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Not provided by eBay";
  return `${seconds} seconds (approximately ${new Date(Date.now() + seconds * 1000).toISOString()})`;
}

export function upsertEnvValue(text, name, value) {
  const line = `${name}=${value}`;
  const expression = new RegExp(`^\\s*${name}=.*$`, "m");
  return expression.test(text) ? text.replace(expression, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
}

async function saveRefreshToken(token) {
  let existing = "";
  try { existing = await readFile(ENV_FILE, "utf8"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  await writeFile(ENV_FILE, upsertEnvValue(existing, "EBAY_REFRESH_TOKEN", token), { encoding: "utf8", mode: 0o600 });
  try { await access(ENV_FILE, constants.R_OK | constants.W_OK); } catch { throw new Error(`Could not verify local token file ${ENV_FILE}.`); }
  output.write(`Saved EBAY_REFRESH_TOKEN to ${ENV_FILE} (ignored by Git).\n`);
}

async function prompt(question) {
  const readline = createInterface({ input, output });
  try { return await readline.question(question); } finally { readline.close(); }
}

async function runAuthorizationFlow() {
  const config = requiredConfig();
  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = buildAuthorizationUrl({ clientId: config.clientId, ruName: config.ruName, state });
  output.write("\nOpen this eBay Production authorization URL in your browser:\n\n");
  output.write(`${authorizationUrl}\n\n`);
  output.write("After approval, copy the complete redirect URL from the browser address bar and paste it below.\n");
  const redirect = await prompt("Redirect URL: ");
  const code = parseAuthorizationRedirect(redirect, state);
  const tokens = await exchangeAuthorizationCode({ ...config, code });
  output.write("\nAuthorization succeeded.\n");
  output.write(`Access token expiry: ${expiryText(Number(tokens.expires_in))}\n`);
  output.write(`Refresh token expiry: ${expiryText(Number(tokens.refresh_token_expires_in))}\n\n`);
  output.write("Store this in Cloudflare as a secret. It is shown only in this local terminal:\n");
  output.write(`EBAY_REFRESH_TOKEN=${tokens.refresh_token}\n\n`);
  const save = await prompt(`Save it locally to ${ENV_FILE} (Git-ignored)? [y/N] `);
  if (/^y(es)?$/i.test(save.trim())) await saveRefreshToken(tokens.refresh_token);
  output.write("\nRun `npm run ebay:oauth:verify` before adding it to Cloudflare.\n");
}

async function runVerification() {
  const config = requiredConfig(true);
  const tokens = await verifyRefreshToken(config);
  output.write("Refresh token verification succeeded.\n");
  output.write(`New access token expiry: ${expiryText(Number(tokens.expires_in))}\n`);
}

async function main() {
  await loadLocalEnv();
  if (process.argv.includes("--verify")) await runVerification();
  else await runAuthorizationFlow();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { output.write(`\nError: ${error instanceof Error ? error.message : "OAuth helper failed."}\n`); process.exitCode = 1; });
}
