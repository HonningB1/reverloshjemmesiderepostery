"use client";

import { useMemo, useState } from "react";

type DealType = "SALE" | "PURCHASE";
type PublicReview = {
  reviewId: string;
  username: string;
  rating: number | null;
  review: string;
  productDeal: string;
  platform: string;
  createdAt: string;
  source: "REVERLO" | "EBAY";
  dealType: DealType | null;
  feedbackType?: string;
  feedbackRole?: "SELLER" | "BUYER";
};

type Filter = "ALL" | DealType;

function formatDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function transactionType(review: PublicReview): DealType | null {
  if (review.source === "EBAY") return (review.feedbackRole ?? "SELLER") === "BUYER" ? "PURCHASE" : "SALE";
  return review.dealType;
}

function RatingStars({ rating }: { rating: number }) {
  return <span className="vouch-rating" aria-label={`${rating} out of 5 stars`}>{"★".repeat(rating)}<i>{"★".repeat(5 - rating)}</i></span>;
}

export function PublicReviewList({ reviews }: { reviews: PublicReview[] }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const counts = useMemo(() => ({
    all: reviews.length,
    sales: reviews.filter((review) => transactionType(review) === "SALE").length,
    purchases: reviews.filter((review) => transactionType(review) === "PURCHASE").length,
  }), [reviews]);
  const filters: Array<{ id: Filter; label: string; count: number }> = [
    { id: "ALL", label: "All", count: counts.all },
    { id: "SALE", label: "Sales", count: counts.sales },
    { id: "PURCHASE", label: "Purchases", count: counts.purchases },
  ];
  const visibleReviews = useMemo(() => reviews.filter((review) => filter === "ALL" || transactionType(review) === filter), [filter, reviews]);

  return <><div className="review-filters" role="tablist" aria-label="Filter public feedback">{filters.map((item) => <button type="button" role="tab" aria-selected={filter === item.id} className={filter === item.id ? "active" : ""} key={item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{item.count}</span></button>)}</div>{visibleReviews.length ? <div className="vouch-grid">{visibleReviews.map((review) => {
    const type = transactionType(review);
    const ebayRole = review.feedbackRole ?? "SELLER";
    const context = review.source === "EBAY"
      ? `eBay · ${ebayRole === "BUYER" ? "Buyer feedback" : "Seller feedback"} · ${review.feedbackType ?? "Feedback"}`
      : `Reverlo · ${type === "SALE" ? "Sale" : type === "PURCHASE" ? "Purchase" : review.platform} · ${formatDate(review.createdAt)}`;
    return <article className="vouch-card" key={`${review.source}-${review.reviewId}`}><div className="vouch-card-top"><div><span className="vouch-avatar">{review.username.slice(0, 1).toUpperCase()}</span><span><strong>{review.username}</strong><small>{context}</small></span></div><div className="vouch-card-meta">{review.rating !== null ? <RatingStars rating={review.rating} /> : null}{review.source === "EBAY" ? <span className={`feedback-role-badge ${ebayRole.toLowerCase()}`}>{ebayRole}</span> : type ? <span className="feedback-role-badge">{type}</span> : <span className="vouch-ref">{review.reviewId}</span>}</div></div>{review.review ? <p>“{review.review}”</p> : <p className="no-comment">No written eBay comment was provided.</p>}<span className="public-review-deal">{review.source === "EBAY" ? review.productDeal || "eBay feedback" : review.productDeal}</span></article>;
  })}</div> : <div className="empty-panel"><span>—</span><p>No feedback in this category yet.</p></div>}</>;
}
