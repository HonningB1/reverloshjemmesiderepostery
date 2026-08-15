import { desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from ".";
import { ebayFeedback, reviews } from "./schema";
import type { ReviewPlatform } from "../app/data/seller";

export type PublicReview = {
  reviewId: string;
  username: string;
  rating: number | null;
  review: string;
  productDeal: string;
  platform: ReviewPlatform | "eBay";
  createdAt: string;
  source: "REVERLO" | "EBAY";
  feedbackType?: string;
};

export async function getPublicReviewData() {
  const db = getDb();
  const [manualSummary] = await db
    .select({
      approvedCount: sql<number>`count(*)`,
      averageRating: sql<number | null>`avg(${reviews.rating})`,
      platformCount: sql<number>`count(distinct ${reviews.platform})`,
    })
    .from(reviews)
    .where(eq(reviews.status, "approved"));

  const [ebaySummary] = await db.select({ count: sql<number>`count(*)` }).from(ebayFeedback).where(isNull(ebayFeedback.hiddenAt));

  const regularReviews = await db
    .select({
      reviewId: reviews.reviewId,
      username: reviews.username,
      rating: reviews.rating,
      review: reviews.review,
      productDeal: reviews.productDeal,
      platform: reviews.platform,
      createdAt: reviews.createdAt,
      source: sql<"REVERLO">`'REVERLO'`,
    })
    .from(reviews)
    .where(eq(reviews.status, "approved"))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(6);

  const importedReviews = await db.select({
    reviewId: ebayFeedback.ebayFeedbackId,
    username: ebayFeedback.username,
    rating: sql<null>`NULL`,
    review: ebayFeedback.comment,
    productDeal: sql<string>`coalesce(${ebayFeedback.itemTitle}, '')`,
    platform: sql<"eBay">`'eBay'`,
    createdAt: ebayFeedback.receivedAt,
    source: sql<"EBAY">`'EBAY'`,
    feedbackType: ebayFeedback.feedbackType,
  }).from(ebayFeedback).where(isNull(ebayFeedback.hiddenAt)).orderBy(desc(ebayFeedback.receivedAt), desc(ebayFeedback.id)).limit(6);

  const approvedReviews = [...regularReviews, ...importedReviews]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 6) as PublicReview[];
  const regularCount = Number(manualSummary?.approvedCount ?? 0);
  const ebayCount = Number(ebaySummary?.count ?? 0);

  return {
    summary: {
      approvedCount: regularCount + ebayCount,
      averageRating: Number(manualSummary?.averageRating ?? 0),
      platformCount: Number(manualSummary?.platformCount ?? 0) + (ebayCount ? 1 : 0),
    },
    approvedReviews,
  };
}
