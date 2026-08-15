"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { reviewPlatforms, socialPlatforms, type SocialPlatform } from "../data/seller";

type ReviewStatus = "pending" | "approved" | "rejected";
type AdminReview = { reviewId: string; username: string; rating: number; review: string; productDeal: string; platform: string; status: ReviewStatus; createdAt: string };
type AdminReviewLink = { id: number; token: string; productDeal: string; defaultPlatform: string | null; createdAt: string; usedAt: string | null; status: "ACTIVE" | "USED"; path: string };
type SocialProfile = { id: number; platform: SocialPlatform; url: string; createdAt: string; updatedAt: string };

const statusLabels: Record<ReviewStatus, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

function formatDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

async function json<T>(response: Response) {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

export default function AdminPage() {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [links, setLinks] = useState<AdminReviewLink[]>([]);
  const [socials, setSocials] = useState<SocialProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [linkDeal, setLinkDeal] = useState("");
  const [linkPlatform, setLinkPlatform] = useState("");
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);
  const [socialPlatform, setSocialPlatform] = useState<SocialPlatform>("eBay");
  const [socialUrl, setSocialUrl] = useState("");
  const [editingSocialId, setEditingSocialId] = useState<number | null>(null);
  const [isSavingSocial, setIsSavingSocial] = useState(false);

  async function loadAdmin() {
    setIsLoading(true); setError(null);
    try {
      const [reviewResult, linkResult, socialResult] = await Promise.all([
        fetch("/api/admin/reviews", { cache: "no-store", credentials: "same-origin" }).then((response) => json<{ reviews: AdminReview[] }>(response)),
        fetch("/api/admin/review-links", { cache: "no-store", credentials: "same-origin" }).then((response) => json<{ links: AdminReviewLink[] }>(response)),
        fetch("/api/admin/socials", { cache: "no-store", credentials: "same-origin" }).then((response) => json<{ socials: SocialProfile[] }>(response)),
      ]);
      setReviews(reviewResult.reviews); setLinks(linkResult.links); setSocials(socialResult.socials);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load the admin data."); }
    finally { setIsLoading(false); }
  }

  useEffect(() => { void loadAdmin(); }, []);

  const grouped = useMemo(() => ({ pending: reviews.filter((review) => review.status === "pending"), approved: reviews.filter((review) => review.status === "approved"), rejected: reviews.filter((review) => review.status === "rejected") }), [reviews]);

  async function updateReview(reviewId: string, action: "approve" | "reject") {
    setUpdatingId(reviewId); setError(null);
    try {
      const result = await json<{ status: ReviewStatus }>(await fetch("/api/admin/reviews", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId, action }) }));
      setReviews((current) => current.map((review) => review.reviewId === reviewId ? { ...review, status: result.status } : review));
    } catch (updateError) { setError(updateError instanceof Error ? updateError.message : "Unable to update the review."); }
    finally { setUpdatingId(null); }
  }

  async function createReviewLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setIsCreatingLink(true);
    try {
      const result = await json<{ link: AdminReviewLink }>(await fetch("/api/admin/review-links", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productDeal: linkDeal, defaultPlatform: linkPlatform }) }));
      setLinks((current) => [result.link, ...current]); setLinkDeal(""); setLinkPlatform("");
    } catch (createError) { setError(createError instanceof Error ? createError.message : "Unable to create the review link."); }
    finally { setIsCreatingLink(false); }
  }

  async function copyLink(link: AdminReviewLink) {
    try { await navigator.clipboard.writeText(`${window.location.origin}${link.path}`); setCopiedLinkId(link.id); window.setTimeout(() => setCopiedLinkId(null), 1800); }
    catch { setError("Unable to copy the link. Please copy it directly from the address shown."); }
  }

  function startSocialEdit(social: SocialProfile) { setEditingSocialId(social.id); setSocialPlatform(social.platform); setSocialUrl(social.url); }
  function resetSocialForm() { setEditingSocialId(null); setSocialPlatform("eBay"); setSocialUrl(""); }

  async function saveSocial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setIsSavingSocial(true);
    try {
      const response = await fetch("/api/admin/socials", { method: editingSocialId ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingSocialId, platform: socialPlatform, url: socialUrl }) });
      const result = await json<{ social: SocialProfile }>(response);
      setSocials((current) => editingSocialId ? current.map((social) => social.id === result.social.id ? result.social : social) : [...current, result.social]); resetSocialForm();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save the social profile."); }
    finally { setIsSavingSocial(false); }
  }

  async function deleteSocial(id: number) {
    setError(null);
    try { await json(await fetch("/api/admin/socials", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })); setSocials((current) => current.filter((social) => social.id !== id)); if (editingSocialId === id) resetSocialForm(); }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to remove the social profile."); }
  }

  return <main><div className="page-shell admin-shell">
    <header className="site-header"><a className="wordmark" href="/" aria-label="Return to Reverlo"><span className="wordmark-mark">RV</span><span>Reverlo</span></a><span className="admin-access">Cloudflare Access protected</span></header>
    <section className="admin-hero"><p className="section-kicker">Moderation & settings</p><h1>Reverlo admin.</h1><p>Review submissions remain private until approved. Review links and public social profiles are managed here.</p></section>
    {error ? <p className="admin-error" role="alert">{error}</p> : null}
    {isLoading ? <p className="admin-loading">Loading protected D1 data...</p> : <div className="admin-groups">
      <section className="admin-section admin-tools" aria-labelledby="review-links-heading"><div className="admin-section-heading"><div><span className="admin-status admin-status-approved">One-time links</span><h2 id="review-links-heading">Generate a review link</h2></div><span>{links.length}</span></div>
        <form className="admin-form" onSubmit={createReviewLink}><label>Product / deal<input value={linkDeal} onChange={(event) => setLinkDeal(event.target.value)} placeholder="e.g. Nike Dunk Low trade" maxLength={160} required /></label><label>Preselect platform <select value={linkPlatform} onChange={(event) => setLinkPlatform(event.target.value)}><option value="">No preselection</option>{reviewPlatforms.map((platform) => <option value={platform} key={platform}>{platform}</option>)}</select></label><button type="submit" disabled={isCreatingLink}>{isCreatingLink ? "Generating..." : "Generate secure link"}</button></form>
        {links.length ? <div className="admin-link-list">{links.map((link) => <article className="admin-link-card" key={link.id}><div><span className={`admin-status ${link.status === "ACTIVE" ? "admin-status-approved" : "admin-status-rejected"}`}>{link.status}</span><strong>{link.productDeal}</strong><small>{link.defaultPlatform ?? "No platform preselected"} · Created {formatDate(link.createdAt)}{link.usedAt ? ` · Used ${formatDate(link.usedAt)}` : ""}</small><code>{window.location.origin}{link.path}</code></div>{link.status === "ACTIVE" ? <button type="button" className="copy-button" onClick={() => void copyLink(link)}>{copiedLinkId === link.id ? "Copied" : "Copy link"}</button> : null}</article>)}</div> : <div className="admin-empty"><span>—</span><p>No review links generated yet.</p></div>}
      </section>
      <section className="admin-section admin-tools" aria-labelledby="socials-heading"><div className="admin-section-heading"><div><span className="admin-status admin-status-approved">Public profile</span><h2 id="socials-heading">Socials & profile settings</h2></div><span>{socials.length}</span></div>
        <form className="admin-form social-form" onSubmit={saveSocial}><label>Platform<select value={socialPlatform} onChange={(event) => setSocialPlatform(event.target.value as SocialPlatform)}>{socialPlatforms.map((platform) => <option value={platform} key={platform}>{platform}</option>)}</select></label><label>Secure profile URL<input type="url" value={socialUrl} onChange={(event) => setSocialUrl(event.target.value)} placeholder="https://..." required /></label><div className="admin-form-actions"><button type="submit" disabled={isSavingSocial}>{isSavingSocial ? "Saving..." : editingSocialId ? "Save profile" : "Add profile"}</button>{editingSocialId ? <button type="button" className="cancel-button" onClick={resetSocialForm}>Cancel</button> : null}</div></form>
        {socials.length ? <div className="admin-social-list">{socials.map((social) => <article className="admin-social-card" key={social.id}><div><strong>{social.platform}</strong><a href={social.url} target="_blank" rel="noreferrer">{social.url}</a></div><div><button type="button" className="text-button" onClick={() => startSocialEdit(social)}>Edit</button><button type="button" className="text-button danger-text" onClick={() => void deleteSocial(social.id)}>Remove</button></div></article>)}</div> : <div className="admin-empty"><span>—</span><p>No public social profiles configured.</p></div>}
      </section>
      {(["pending", "approved", "rejected"] as ReviewStatus[]).map((status) => <section className="admin-section" key={status} aria-labelledby={`${status}-heading`}><div className="admin-section-heading"><div><span className={`admin-status admin-status-${status}`}>{statusLabels[status]}</span><h2 id={`${status}-heading`}>{statusLabels[status]} reviews</h2></div><span>{grouped[status].length}</span></div>{grouped[status].length ? <div className="admin-review-list">{grouped[status].map((review) => <article className="admin-review-card" key={review.reviewId}><div className="admin-card-heading"><div><code>{review.reviewId}</code><strong>{review.username}</strong><span>{review.platform} · {formatDate(review.createdAt)}</span></div><span className="admin-rating" aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}<i>{"★".repeat(5 - review.rating)}</i></span></div><div className="admin-deal"><span>Product / deal</span><strong>{review.productDeal}</strong></div><p>“{review.review}”</p>{status === "pending" ? <div className="admin-actions"><button type="button" className="approve-button" disabled={updatingId === review.reviewId} onClick={() => void updateReview(review.reviewId, "approve")}>Approve</button><button type="button" className="reject-button" disabled={updatingId === review.reviewId} onClick={() => void updateReview(review.reviewId, "reject")}>Reject</button></div> : null}</article>)}</div> : <div className="admin-empty"><span>—</span><p>No {status} reviews.</p></div>}</section>)}
    </div>}
  </div></main>;
}
