import { env } from "cloudflare:workers";

type ReviewStatus = "pending" | "approved" | "rejected";
type ReviewSource = "REVERLO" | "EBAY";

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("no such table") || message.includes("reviews") || message.includes("ebay_feedback");
}

function unavailable() { return Response.json({ error: "Review storage is not initialized yet." }, { status: 503 }); }
function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/Bearer\s+\S+|refresh_token[^\s&]*/gi, "[redacted]").slice(0, 500);
}

// Cloudflare Access must protect /api/admin/* with the same policy as /admin.
// It deliberately has no second, application-level login system.
export async function GET() {
  if (!env.DB) return unavailable();
  try {
    const result = await env.DB.prepare(
      `SELECT * FROM (
         SELECT review_id AS reviewId, username, rating, review, product_deal AS productDeal, platform, status,
              created_at AS createdAt, 'REVERLO' AS source, NULL AS feedbackType, NULL AS hiddenAt
         FROM reviews
         UNION ALL
         SELECT ebay_feedback_id AS reviewId, username, NULL AS rating, comment AS review, item_title AS productDeal,
              'eBay' AS platform, CASE WHEN hidden_at IS NULL THEN 'approved' ELSE 'rejected' END AS status,
              received_at AS createdAt, 'EBAY' AS source, feedback_type AS feedbackType, hidden_at AS hiddenAt
         FROM ebay_feedback
       ) AS admin_reviews
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, createdAt DESC`,
    ).all();
    return Response.json({ reviews: result.results });
  } catch (error) {
    console.error("Reverlo admin reviews list failed", { message: safeErrorMessage(error) });
    if (databaseError(error)) return unavailable();
    return Response.json({ error: "Unable to load reviews." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!env.DB) return unavailable();
  try {
    const payload = (await request.json()) as { reviewId?: unknown; action?: unknown; source?: unknown };
    const reviewId = typeof payload.reviewId === "string" ? payload.reviewId : "";
    const status: ReviewStatus | null = payload.action === "approve" ? "approved" : payload.action === "reject" ? "rejected" : null;
    if (payload.source !== "REVERLO" || !/^REV-\d{4,}$/.test(reviewId) || !status) return Response.json({ error: "Invalid review update." }, { status: 400 });
    const result = await env.DB.prepare("UPDATE reviews SET status = ? WHERE review_id = ? AND status = 'pending'").bind(status, reviewId).run();
    if (result.meta.changes !== 1) return Response.json({ error: "This review is no longer pending." }, { status: 409 });
    return Response.json({ reviewId, status });
  } catch (error) {
    console.error("Reverlo admin review update failed", { message: safeErrorMessage(error) });
    if (databaseError(error)) return unavailable();
    return Response.json({ error: "Unable to update the review." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!env.DB) return unavailable();
  try {
    const payload = (await request.json()) as { reviewId?: unknown; source?: unknown };
    const reviewId = typeof payload.reviewId === "string" ? payload.reviewId : "";
    const source = payload.source as ReviewSource;
    if (!reviewId || (source !== "REVERLO" && source !== "EBAY")) return Response.json({ error: "Invalid review removal." }, { status: 400 });
    if (source === "REVERLO") {
      if (!/^REV-\d{4,}$/.test(reviewId)) return Response.json({ error: "Invalid review removal." }, { status: 400 });
      const result = await env.DB.prepare("DELETE FROM reviews WHERE review_id = ?").bind(reviewId).run();
      if (result.meta.changes !== 1) return Response.json({ error: "Review was not found." }, { status: 404 });
      return Response.json({ reviewId, deleted: true });
    }
    const result = await env.DB.prepare("UPDATE ebay_feedback SET hidden_at = CURRENT_TIMESTAMP WHERE ebay_feedback_id = ? AND hidden_at IS NULL").bind(reviewId).run();
    if (result.meta.changes !== 1) return Response.json({ error: "eBay feedback was not found or is already hidden." }, { status: 404 });
    return Response.json({ reviewId, hidden: true });
  } catch (error) {
    console.error("Reverlo admin review removal failed", { message: safeErrorMessage(error) });
    if (databaseError(error)) return unavailable();
    return Response.json({ error: "Unable to remove the review." }, { status: 500 });
  }
}
