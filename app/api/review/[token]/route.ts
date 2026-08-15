import { env } from "cloudflare:workers";
import { reviewPlatforms } from "../../../data/seller";

type ReviewPayload = {
  username?: unknown;
  rating?: unknown;
  review?: unknown;
  platform?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isToken(value: string) {
  return /^[A-Za-z0-9_-]{40,}$/.test(value);
}

function storageError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("no such table") || message.includes("review_links") || message.includes("review_counters");
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!env.DB) return Response.json({ error: "Review storage is not configured yet." }, { status: 503 });

  const { token } = await context.params;
  if (!isToken(token)) return Response.json({ error: "This review link is invalid." }, { status: 404 });

  try {
    const payload = (await request.json()) as ReviewPayload;
    const username = cleanText(payload.username, 80);
    const review = cleanText(payload.review, 1_500);
    const platform = cleanText(payload.platform, 32);
    const rating = Number(payload.rating);

    if (!username || !review || !reviewPlatforms.includes(platform as (typeof reviewPlatforms)[number]) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return Response.json({ error: "Please complete every review field with a valid rating." }, { status: 400 });
    }

    const submissionToken = crypto.randomUUID();
    const result = await env.DB.batch([
      // The counter is advanced only when this exact link is still active.
      env.DB.prepare(
        "UPDATE review_counters SET current_value = current_value + 1 WHERE name = 'reviews' AND EXISTS (SELECT 1 FROM review_links WHERE token = ? AND used_at IS NULL)",
      ).bind(token),
      // Product/deal and link ownership are selected from D1, never supplied by the browser.
      env.DB.prepare(
        `INSERT INTO reviews (review_id, submission_token, review_link_id, username, rating, review, product_deal, platform, status)
         SELECT 'REV-' || printf('%04d', review_counters.current_value), ?, review_links.id, ?, ?, ?, review_links.product_deal, ?, 'pending'
         FROM review_counters CROSS JOIN review_links
         WHERE review_counters.name = 'reviews' AND review_links.token = ? AND review_links.used_at IS NULL`,
      ).bind(submissionToken, username, rating, review, platform, token),
      // D1 batches are atomic: if the insert cannot happen, neither this update nor the counter update persists.
      env.DB.prepare("UPDATE review_links SET used_at = CURRENT_TIMESTAMP WHERE token = ? AND used_at IS NULL").bind(token),
    ]);

    if (result[1]?.meta.changes !== 1 || result[2]?.meta.changes !== 1) {
      const link = await env.DB.prepare("SELECT used_at FROM review_links WHERE token = ?").bind(token).first<{ used_at: string | null }>();
      return Response.json(
        { error: link?.used_at ? "This review link has already been used." : "This review link is invalid." },
        { status: link?.used_at ? 409 : 404 },
      );
    }

    const created = await env.DB
      .prepare("SELECT review_id AS reviewId, created_at AS createdAt FROM reviews WHERE submission_token = ?")
      .bind(submissionToken)
      .first<{ reviewId: string; createdAt: string }>();

    if (!created) throw new Error("Review could not be confirmed after insertion.");

    return Response.json({ ...created, status: "pending" }, { status: 201 });
  } catch (error) {
    if (storageError(error)) return Response.json({ error: "Reviews are not initialized yet. Apply the D1 migration first." }, { status: 503 });
    return Response.json({ error: "Unable to submit the review right now. Please try again." }, { status: 500 });
  }
}
