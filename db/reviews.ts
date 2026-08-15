import { desc, eq, sql } from "drizzle-orm";
import { getDb } from ".";
import { reviews } from "./schema";
import type { ReviewPlatform } from "../app/data/seller";

export type PublicReview = {
  reviewId: string;
  username: string;
  rating: number;
  review: string;
  productDeal: string;
  platform: ReviewPlatform;
  createdAt: string;
};

export async function getPublicReviewData() {
  const db = getDb();
  const [summary] = await db
    .select({
      approvedCount: sql<number>`count(*)`,
      averageRating: sql<number | null>`avg(${reviews.rating})`,
      platformCount: sql<number>`count(distinct ${reviews.platform})`,
    })
    .from(reviews)
    .where(eq(reviews.status, "approved"));

  const approvedReviews = await db
    .select({
      reviewId: reviews.reviewId,
      username: reviews.username,
      rating: reviews.rating,
      review: reviews.review,
      productDeal: reviews.productDeal,
      platform: reviews.platform,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(eq(reviews.status, "approved"))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(6);

  return {
    summary: {
      approvedCount: Number(summary?.approvedCount ?? 0),
      averageRating: Number(summary?.averageRating ?? 0),
      platformCount: Number(summary?.platformCount ?? 0),
    },
    approvedReviews: approvedReviews as PublicReview[],
  };
}
