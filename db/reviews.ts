import { desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from ".";
import { ebayFeedback, reviews } from "./schema";
import type { ReviewPlatform } from "../app/data/seller";

export type DealType = "SALE" | "PURCHASE";

export type PublicReview = {
  reviewId: string;
  username: string;
  rating: number | null;
  review: string;
  productDeal: string;
  platform: ReviewPlatform | "eBay";
  createdAt: string;
  source: "REVERLO" | "EBAY";
  dealType: DealType | null;
  feedbackType?: string;
  feedbackRole?: "SELLER" | "BUYER";
};

// eBay returns a three-state feedback type. Keep the original value intact,
// while exposing this deterministic five-star representation to Reverlo.
const ebayRating = sql<number | null>`case lower(trim(${ebayFeedback.feedbackType}))
  when 'positive' then 5
  when 'neutral' then 3
  when 'negative' then 1
  else null
end`;

export async function getPublicReviewData() {
  const db = getDb();
  const [manualSummary] = await db
    .select({
      approvedCount: sql<number>`count(*)`,
      saleCount: sql<number>`coalesce(sum(case when ${reviews.dealType} = 'SALE' then 1 else 0 end), 0)`,
      purchaseCount: sql<number>`coalesce(sum(case when ${reviews.dealType} = 'PURCHASE' then 1 else 0 end), 0)`,
      ratingTotal: sql<number>`coalesce(sum(${reviews.rating}), 0)`,
      ratingCount: sql<number>`count(${reviews.rating})`,
      platformCount: sql<number>`count(distinct ${reviews.platform})`,
    })
    .from(reviews)
    .where(eq(reviews.status, "approved"));

  const [ebaySummary] = await db.select({
    count: sql<number>`count(*)`,
    sellerCount: sql<number>`coalesce(sum(case when ${ebayFeedback.feedbackRole} = 'SELLER' then 1 else 0 end), 0)`,
    buyerCount: sql<number>`coalesce(sum(case when ${ebayFeedback.feedbackRole} = 'BUYER' then 1 else 0 end), 0)`,
    ratingTotal: sql<number>`coalesce(sum(${ebayRating}), 0)`,
    ratingCount: sql<number>`coalesce(sum(case when ${ebayRating} is null then 0 else 1 end), 0)`,
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
      dealType: reviews.dealType,
    })
    .from(reviews)
    .where(eq(reviews.status, "approved"))
    .orderBy(desc(reviews.createdAt), desc(reviews.id));

  const importedReviews = await db.select({
    reviewId: ebayFeedback.ebayFeedbackId,
    username: ebayFeedback.username,
    rating: ebayRating,
    review: ebayFeedback.comment,
    productDeal: sql<string>`coalesce(${ebayFeedback.itemTitle}, '')`,
    platform: sql<"eBay">`'eBay'`,
    createdAt: ebayFeedback.receivedAt,
    source: sql<"EBAY">`'EBAY'`,
    dealType: sql<DealType>`case when ${ebayFeedback.feedbackRole} = 'BUYER' then 'PURCHASE' else 'SALE' end`,
    feedbackType: ebayFeedback.feedbackType,
    feedbackRole: ebayFeedback.feedbackRole,
  }).from(ebayFeedback).where(isNull(ebayFeedback.hiddenAt)).orderBy(desc(ebayFeedback.receivedAt), desc(ebayFeedback.id));

  const approvedReviews = [...regularReviews, ...importedReviews]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)) as PublicReview[];
  const reverloCount = Number(manualSummary?.approvedCount ?? 0);
  const ebayCount = Number(ebaySummary?.count ?? 0);
  const saleCount = Number(manualSummary?.saleCount ?? 0) + Number(ebaySummary?.sellerCount ?? 0);
  const purchaseCount = Number(manualSummary?.purchaseCount ?? 0) + Number(ebaySummary?.buyerCount ?? 0);
  const ratingTotal = Number(manualSummary?.ratingTotal ?? 0) + Number(ebaySummary?.ratingTotal ?? 0);
  const ratingCount = Number(manualSummary?.ratingCount ?? 0) + Number(ebaySummary?.ratingCount ?? 0);

  return {
    summary: {
      approvedCount: reverloCount + ebayCount,
      saleCount,
      purchaseCount,
      averageRating: ratingCount ? ratingTotal / ratingCount : 0,
      platformCount: Number(manualSummary?.platformCount ?? 0) + (ebayCount ? 1 : 0),
    },
    approvedReviews,
  };
}
