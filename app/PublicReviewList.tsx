"use client";

import { useMemo, useState } from "react";

type PublicReview = {
  reviewId: string;
  username: string;
  rating: number | null;
  review: string;
  productDeal: string;
  platform: string;
  createdAt: string;
  source: "REVERLO" | "EBAY";
  feedbackType?: string;
  feedbackRole?: "SELLER" | "BUYER";
};

type Filter = "ALL" | "REVERLO" | "EBAY_SELLER" | "EBAY_BUYER";

function formatDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function PublicReviewList({ reviews, counts }: { reviews: PublicReview[]; counts: { reverlo: number; ebaySeller: number; ebayBuyer: number } }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const filters: Array<{ id: Filter; label: string; count: number }> = [
    { id: "ALL", label: "All", count: counts.reverlo + counts.ebaySeller + counts.ebayBuyer },
    { id: "REVERLO", label: "Reverlo", count: counts.reverlo },
    { id: "EBAY_SELLER", label: "eBay Seller", count: counts.ebaySeller },
    { id: "EBAY_BUYER", label: "eBay Buyer", count: counts.ebayBuyer },
  ];
  const visibleReviews = useMemo(() => reviews.filter((review) => {
    if (filter === "ALL") return true;
    if (filter === "REVERLO") return review.source === "REVERLO";
    return review.source === "EBAY" && (review.feedbackRole ?? "SELLER") === (filter === "EBAY_SELLER" ? "SELLER" : "BUYER");
  }), [filter, reviews]);

  return <><div className="review-filters" role="tablist" aria-label="Filter public feedback">{filters.map((item) => <button type="button" role="tab" aria-selected={filter === item.id} className={filter === item.id ? "active" : ""} key={item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{item.count}</span></button>)}</div>{visibleReviews.length ? <div className="vouch-grid">{visibleReviews.map((review) => {
    const ebayRole = review.feedbackRole ?? "SELLER";
    const roleLabel = ebayRole === "BUYER" ? "Buyer feedback" : "Seller feedback";
    return <article className="vouch-card" key={`${review.source}-${review.reviewId}`}><div className="vouch-card-top"><div><span className="vouch-avatar">{review.username.slice(0, 1).toUpperCase()}</span><span><strong>{review.username}</strong><small>{review.source === "EBAY" ? `eBay · ${roleLabel} · ${review.feedbackType ?? "Feedback"}` : `${review.platform} · ${formatDate(review.createdAt)}`}</small></span></div>{review.source === "EBAY" ? <span className={`feedback-role-badge ${ebayRole.toLowerCase()}`}>{ebayRole}</span> : <span className="vouch-ref">{review.reviewId}</span>}</div>{review.review ? <p>“{review.review}”</p> : <p className="no-comment">No written eBay comment was provided.</p>}<span className="public-review-deal">{review.source === "EBAY" ? review.productDeal || "eBay feedback" : `${review.productDeal} · ${review.rating}/5`}</span></article>;
  })}</div> : <div className="empty-panel"><span>—</span><p>No feedback in this category yet.</p></div>}</>;
}
