import { env } from "cloudflare:workers";

const platforms = new Set(["Discord", "X", "eBay", "Direct"]);

type ReviewPayload = {
  username?: unknown;
  rating?: unknown;
  review?: unknown;
  productDeal?: unknown;
  platform?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function configurationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("no such table") || message.includes("review_counters");
}

export async function POST(request: Request) {
  if (!env.DB) {
    return Response.json({ error: "Review storage is not configured yet." }, { status: 503 });
  }

  try {
    const payload = (await request.json()) as ReviewPayload;
    const username = cleanText(payload.username, 80);
    const review = cleanText(payload.review, 1_500);
    const productDeal = cleanText(payload.productDeal, 160);
    const platform = cleanText(payload.platform, 32);
    const rating = Number(payload.rating);

    if (!username || !review || !productDeal || !platforms.has(platform) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return Response.json({ error: "Please complete every review field with a valid rating." }, { status: 400 });
    }

    const submissionToken = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE review_counters SET current_value = current_value + 1 WHERE name = 'reviews'"),
      env.DB.prepare(
        `INSERT INTO reviews (review_id, submission_token, username, rating, review, product_deal, platform, status)
         SELECT 'REV-' || printf('%04d', current_value), ?, ?, ?, ?, ?, ?, 'pending'
         FROM review_counters
         WHERE name = 'reviews'`,
      ).bind(submissionToken, username, rating, review, productDeal, platform),
    ]);

    const created = await env.DB
      .prepare("SELECT review_id, created_at FROM reviews WHERE submission_token = ?")
      .bind(submissionToken)
      .first<{ review_id: string; created_at: string }>();

    if (!created) {
      throw new Error("Review could not be confirmed after insertion.");
    }

    return Response.json(
      { reviewId: created.review_id, createdAt: created.created_at, status: "pending" },
      { status: 201 },
    );
  } catch (error) {
    if (configurationError(error)) {
      return Response.json({ error: "Reviews are not initialized yet. Apply the D1 migration first." }, { status: 503 });
    }

    return Response.json({ error: "Unable to submit the review right now. Please try again." }, { status: 500 });
  }
}
