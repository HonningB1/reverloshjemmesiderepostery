export type EbayEnvironment = {
  DB: D1Database;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_REFRESH_TOKEN?: string;
  EBAY_ENVIRONMENT?: string;
  EBAY_SITE_ID?: string;
  EBAY_COMPATIBILITY_LEVEL?: string;
};

type EbayFeedback = {
  feedbackId: string;
  username: string;
  comment: string;
  feedbackType: string;
  itemId: string | null;
  itemTitle: string | null;
  receivedAt: string;
  role: string;
};

type EbayPage = { totalPages: number; feedback: EbayFeedback[] };
export type EbaySyncResult = { ok: boolean; connected: boolean; importedCount: number; processed: number; error?: string };

const MAX_PAGES = 1000;

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function field(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

export function parseGetFeedbackResponse(xml: string): EbayPage {
  const feedback: EbayFeedback[] = [];
  for (const match of xml.matchAll(/<FeedbackDetail(?:\s[^>]*)?>([\s\S]*?)<\/FeedbackDetail>/gi)) {
    const entry = match[1];
    const feedbackId = field(entry, "FeedbackID");
    if (!feedbackId) continue;
    feedback.push({
      feedbackId,
      username: field(entry, "CommentingUser") || "eBay buyer",
      comment: field(entry, "CommentText"),
      feedbackType: field(entry, "CommentType") || "Unknown",
      itemId: field(entry, "ItemID") || null,
      itemTitle: field(entry, "ItemTitle") || null,
      receivedAt: field(entry, "CommentTime") || new Date().toISOString(),
      role: field(entry, "Role"),
    });
  }

  return { totalPages: Math.max(1, Number.parseInt(field(xml, "TotalNumberOfPages"), 10) || 1), feedback };
}

export function buildGetFeedbackRequest(page: number) {
  return `<?xml version="1.0" encoding="utf-8"?><GetFeedbackRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnAll</DetailLevel><FeedbackType>FeedbackReceivedAsSeller</FeedbackType><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></GetFeedbackRequest>`;
}

function hasCredentials(env: EbayEnvironment) {
  return Boolean(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET && env.EBAY_REFRESH_TOKEN);
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "eBay sync failed.";
  // Keep stored errors useful without ever retaining an OAuth response or token.
  return message.replace(/Bearer\s+\S+|refresh_token[^\s&]*/gi, "[redacted]").slice(0, 500);
}

async function updateState(db: D1Database, values: { error?: string | null; success?: boolean; importedCount?: number }) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO ebay_sync_state (id, last_sync_at, last_success_at, imported_count, last_error, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_success_at = excluded.last_success_at,
       imported_count = excluded.imported_count, last_error = excluded.last_error, updated_at = excluded.updated_at`,
  ).bind(now, values.success ? now : null, values.importedCount ?? 0, values.error ?? null, now).run();
}

async function accessToken(env: EbayEnvironment, fetcher: typeof fetch) {
  const sandbox = env.EBAY_ENVIRONMENT === "sandbox";
  const origin = sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const credentials = btoa(`${env.EBAY_CLIENT_ID!}:${env.EBAY_CLIENT_SECRET!}`);
  const response = await fetcher(`${origin}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: env.EBAY_REFRESH_TOKEN! }).toString(),
  });
  if (!response.ok) throw new Error("eBay OAuth refresh failed. Check the Worker secrets and eBay consent.");
  const payload = await response.json() as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) throw new Error("eBay did not return an access token.");
  return { token: payload.access_token, origin };
}

async function getFeedbackPage(env: EbayEnvironment, token: string, origin: string, page: number, fetcher: typeof fetch) {
  const response = await fetcher(`${origin}/ws/api.dll`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetFeedback",
      "X-EBAY-API-COMPATIBILITY-LEVEL": env.EBAY_COMPATIBILITY_LEVEL || "1423",
      "X-EBAY-API-SITEID": env.EBAY_SITE_ID || "0",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: buildGetFeedbackRequest(page),
  });
  const xml = await response.text();
  if (!response.ok || /<Ack>Failure<\/Ack>/i.test(xml)) {
    throw new Error(`eBay GetFeedback failed${response.status ? ` (${response.status})` : ""}.`);
  }
  return parseGetFeedbackResponse(xml);
}

async function upsertFeedback(db: D1Database, entry: EbayFeedback) {
  await db.prepare(
    `INSERT INTO ebay_feedback (ebay_feedback_id, username, comment, feedback_type, item_id, item_title, received_at, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'EBAY', CURRENT_TIMESTAMP)
     ON CONFLICT(ebay_feedback_id) DO UPDATE SET username = excluded.username, comment = excluded.comment,
       feedback_type = excluded.feedback_type, item_id = excluded.item_id, item_title = excluded.item_title,
       received_at = excluded.received_at, updated_at = CURRENT_TIMESTAMP`,
  ).bind(entry.feedbackId, entry.username, entry.comment, entry.feedbackType, entry.itemId, entry.itemTitle, entry.receivedAt).run();
}

export async function getEbaySyncStatus(db: D1Database, connected: boolean) {
  const state = await db.prepare("SELECT last_sync_at AS lastSyncAt, last_success_at AS lastSuccessAt, imported_count AS importedCount, last_error AS lastError FROM ebay_sync_state WHERE id = 1").first<{ lastSyncAt: string | null; lastSuccessAt: string | null; importedCount: number; lastError: string | null }>();
  const count = await db.prepare("SELECT count(*) AS count FROM ebay_feedback").first<{ count: number }>();
  return { connected, lastSyncAt: state?.lastSyncAt ?? null, lastSuccessAt: state?.lastSuccessAt ?? null, importedCount: Number(count?.count ?? 0), lastError: state?.lastError ?? null };
}

export async function syncEbayFeedback(env: EbayEnvironment, fetcher: typeof fetch = fetch): Promise<EbaySyncResult> {
  if (!hasCredentials(env)) {
    await updateState(env.DB, { error: "eBay is not configured. Add the required Worker secrets." });
    return { ok: false, connected: false, importedCount: 0, processed: 0, error: "eBay is not configured." };
  }
  try {
    const { token, origin } = await accessToken(env, fetcher);
    let processed = 0;
    const first = await getFeedbackPage(env, token, origin, 1, fetcher);
    const pages = Math.min(first.totalPages, MAX_PAGES);
    const savePage = async (data: EbayPage) => {
      for (const entry of data.feedback) {
        // The server filter is authoritative; this extra guard makes accidental
        // import of buyer feedback impossible if eBay ever returns mixed data.
        if (entry.role && entry.role.toLowerCase() !== "seller") continue;
        await upsertFeedback(env.DB, entry);
        processed += 1;
      }
    };
    await savePage(first);
    for (let page = 2; page <= pages; page += 1) await savePage(await getFeedbackPage(env, token, origin, page, fetcher));
    const total = await env.DB.prepare("SELECT count(*) AS count FROM ebay_feedback").first<{ count: number }>();
    await updateState(env.DB, { success: true, importedCount: Number(total?.count ?? 0) });
    return { ok: true, connected: true, importedCount: Number(total?.count ?? 0), processed };
  } catch (error) {
    const message = errorMessage(error);
    await updateState(env.DB, { error: message });
    return { ok: false, connected: true, importedCount: 0, processed: 0, error: message };
  }
}
