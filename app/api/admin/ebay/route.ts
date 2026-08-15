import { env } from "cloudflare:workers";
import { getEbaySyncStatus, syncEbayFeedback, type EbayEnvironment } from "../../../../lib/ebay-feedback";

function unavailable() { return Response.json({ error: "Review storage is not initialized yet." }, { status: 503 }); }
function configured() { return Boolean(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET && env.EBAY_REFRESH_TOKEN); }
function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/Bearer\s+\S+|refresh_token[^\s&]*/gi, "[redacted]").slice(0, 500);
}

// Cloudflare Access protects /api/admin/*; OAuth data never reaches the browser.
export async function GET() {
  if (!env.DB) return unavailable();
  try { return Response.json(await getEbaySyncStatus(env.DB, configured())); }
  catch (error) {
    console.error("Reverlo admin eBay status failed", { message: safeErrorMessage(error) });
    return Response.json({ error: "Unable to load eBay integration status." }, { status: 500 });
  }
}

export async function POST() {
  if (!env.DB) return unavailable();
  const result = await syncEbayFeedback(env as EbayEnvironment);
  return Response.json(result, { status: result.ok ? 200 : result.connected ? 502 : 409 });
}
