import { env } from "cloudflare:workers";

type ReviewStatus = "pending" | "approved" | "rejected";

type AdminReview = {
  reviewId: string;
  username: string;
  rating: number;
  review: string;
  productDeal: string;
  platform: string;
  status: ReviewStatus;
  createdAt: string;
};

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("no such table") || message.includes("reviews");
}

function unavailable() {
  return Response.json({ error: "Review storage is not initialized yet." }, { status: 503 });
}

// This route lives under /admin so the existing Cloudflare Access policy can protect
// the page and its data API together. No application-level login is introduced here.
export async function GET() {
  if (!env.DB) return unavailable();

  try {
    const result = await env.DB.prepare(
      `SELECT review_id AS reviewId, username, rating, review, product_deal AS productDeal,
              platform, status, created_at AS createdAt
       FROM reviews
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                created_at DESC, id DESC`,
    ).all<AdminReview>();

    return Response.json({ reviews: result.results });
  } catch (error) {
    if (databaseError(error)) return unavailable();
    return Response.json({ error: "Unable to load reviews." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!env.DB) return unavailable();

  try {
    const payload = (await request.json()) as { reviewId?: unknown; action?: unknown };
    const reviewId = typeof payload.reviewId === "string" ? payload.reviewId : "";
    const status = payload.action === "approve" ? "approved" : payload.action === "reject" ? "rejected" : null;

    if (!/^REV-\d{4,}$/.test(reviewId) || !status) {
      return Response.json({ error: "Invalid review update." }, { status: 400 });
    }

    const result = await env.DB
      .prepare("UPDATE reviews SET status = ? WHERE review_id = ? AND status = 'pending'")
      .bind(status, reviewId)
      .run();

    if (result.meta.changes !== 1) {
      return Response.json({ error: "This review is no longer pending." }, { status: 409 });
    }

    return Response.json({ reviewId, status });
  } catch (error) {
    if (databaseError(error)) return unavailable();
    return Response.json({ error: "Unable to update the review." }, { status: 500 });
  }
}
