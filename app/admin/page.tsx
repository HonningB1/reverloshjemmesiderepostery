"use client";

import { useEffect, useMemo, useState } from "react";

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

const statusLabels: Record<ReviewStatus, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

function formatDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export default function AdminPage() {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function loadReviews() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/admin/api/reviews", { cache: "no-store" });
      const result = (await response.json()) as { reviews?: AdminReview[]; error?: string };
      if (!response.ok || !result.reviews) throw new Error(result.error ?? "Unable to load reviews.");
      setReviews(result.reviews);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load reviews.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void loadReviews(); }, []);

  const grouped = useMemo(() => ({
    pending: reviews.filter((review) => review.status === "pending"),
    approved: reviews.filter((review) => review.status === "approved"),
    rejected: reviews.filter((review) => review.status === "rejected"),
  }), [reviews]);

  async function updateReview(reviewId: string, action: "approve" | "reject") {
    setUpdatingId(reviewId);
    setError(null);
    try {
      const response = await fetch("/admin/api/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, action }),
      });
      const result = (await response.json()) as { status?: ReviewStatus; error?: string };
      if (!response.ok || !result.status) throw new Error(result.error ?? "Unable to update the review.");
      setReviews((current) => current.map((review) => review.reviewId === reviewId ? { ...review, status: result.status! } : review));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update the review.");
    } finally {
      setUpdatingId(null);
    }
  }

  return <main><div className="page-shell admin-shell">
    <header className="site-header"><a className="wordmark" href="/" aria-label="Return to seller profile"><span className="wordmark-mark">RT</span><span>Reputation <i>Profile</i></span></a><span className="admin-access">Cloudflare Access protected</span></header>
    <section className="admin-hero"><p className="section-kicker">Moderation</p><h1>Review admin.</h1><p>Review submissions stay private until you approve them. Only approved reviews can appear on the public profile.</p></section>
    {error ? <p className="admin-error" role="alert">{error}</p> : null}
    {isLoading ? <p className="admin-loading">Loading reviews from D1...</p> : <div className="admin-groups">
      {(["pending", "approved", "rejected"] as ReviewStatus[]).map((status) => <section className="admin-section" key={status} aria-labelledby={`${status}-heading`}>
        <div className="admin-section-heading"><div><span className={`admin-status admin-status-${status}`}>{statusLabels[status]}</span><h2 id={`${status}-heading`}>{statusLabels[status]} reviews</h2></div><span>{grouped[status].length}</span></div>
        {grouped[status].length ? <div className="admin-review-list">{grouped[status].map((review) => <article className="admin-review-card" key={review.reviewId}>
          <div className="admin-card-heading"><div><code>{review.reviewId}</code><strong>{review.username}</strong><span>{review.platform} · {formatDate(review.createdAt)}</span></div><span className="admin-rating" aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}<i>{"★".repeat(5 - review.rating)}</i></span></div>
          <div className="admin-deal"><span>Product / deal</span><strong>{review.productDeal}</strong></div><p>“{review.review}”</p>
          {status === "pending" ? <div className="admin-actions"><button type="button" className="approve-button" disabled={updatingId === review.reviewId} onClick={() => void updateReview(review.reviewId, "approve")}>Approve</button><button type="button" className="reject-button" disabled={updatingId === review.reviewId} onClick={() => void updateReview(review.reviewId, "reject")}>Reject</button></div> : null}
        </article>)}</div> : <div className="admin-empty"><span>—</span><p>No {status} reviews.</p></div>}
      </section>)}
    </div>}
  </div></main>;
}
