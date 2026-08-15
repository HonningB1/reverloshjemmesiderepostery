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
  feedbackRole?: "SELLER" | "BUYER";
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

  const [ebaySummary] = await db.select({
    count: sql<number>`count(*)`,
    sellerCount: sql<number>`coalesce(sum(case when ${ebayFeedback.feedbackRole} = 'SELLER' then 1 else 0 end), 0)`,
    buyerCount: sql<number>`coalesce(sum(case when ${ebayFeedback.feedbackRole} = 'BUYER' then 1 else 0 end), 0)`,
  }).from(ebayFeedback).where(isNull(ebayFeedback.hiddenAt));

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
    .orderBy(desc(reviews.createdAt), desc(reviews.id));

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
    feedbackRole: ebayFeedback.feedbackRole,
  }).from(ebayFeedback).where(isNull(ebayFeedback.hiddenAt)).orderBy(desc(ebayFeedback.receivedAt), desc(ebayFeedback.id));

  const approvedReviews = [...regularReviews, ...importedReviews]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)) as PublicReview[];
  const regularCount = Number(manualSummary?.approvedCount ?? 0);
  const ebayCount = Number(ebaySummary?.count ?? 0);
  const ebaySellerCount = Number(ebaySummary?.sellerCount ?? 0);
  const ebayBuyerCount = Number(ebaySummary?.buyerCount ?? 0);

  return {
    summary: {
      approvedCount: regularCount + ebayCount,
      reverloCount: regularCount,
      ebaySellerCount,
      ebayBuyerCount,
      averageRating: Number(manualSummary?.averageRating ?? 0),
      platformCount: Number(manualSummary?.platformCount ?? 0) + (ebayCount ? 1 : 0),
    },
    approvedReviews,
  };
}
