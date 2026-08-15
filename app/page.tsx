import { getPublicSocialProfiles } from "../db/profile";
import { getPublicReviewData } from "../db/reviews";
import { brand, type SocialPlatform } from "./data/seller";

export const dynamic = "force-dynamic";

function CheckIcon() { return <span className="check-icon" aria-hidden="true">✓</span>; }

function formatDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function socialMark(platform: SocialPlatform) {
  return { eBay: "e", Discord: "#", Instagram: "◎", "X/Twitter": "𝕏", Facebook: "f", TikTok: "♪", YouTube: "▶", Website: "↗" }[platform];
}

export default async function Home() {
  const [reputation, socials] = await Promise.all([
    getPublicReviewData().catch(() => ({ summary: { approvedCount: 0, averageRating: 0, platformCount: 0 }, approvedReviews: [] })),
    getPublicSocialProfiles().catch(() => []),
  ]);
  const stats = [
    { label: "Approved reviews", value: String(reputation.summary.approvedCount), detail: "Public buyer references" },
    { label: "Average rating", value: reputation.summary.averageRating ? `${reputation.summary.averageRating.toFixed(1)} / 5` : "—", detail: "Reverlo reviews only" },
    { label: "Platforms", value: String(reputation.summary.platformCount), detail: "With approved references" },
    { label: "Public status", value: "Verified", detail: "Pending reviews stay private" },
  ];

  return <main><div className="page-shell">
    <header className="site-header"><a className="wordmark" href="#top" aria-label="Reverlo home"><span className="wordmark-mark">{brand.mark}</span><span>{brand.name}</span></a><nav aria-label="Primary navigation"><a href="#reviews">Reviews</a><a href="#profiles">Profiles</a><a href="#verify">Legit check</a></nav><a className="header-cta" href="#verify">Verify a seller <span aria-hidden="true">→</span></a></header>
    <section className="hero" id="top"><div className="identity-block"><div className="status-line"><span className="pulse-dot" /> {brand.availability}</div><p className="eyebrow">Independent seller verification</p><h1>Reverlo.</h1><p className="hero-copy">A transparent record of publicly approved buyer references and verified social profiles for safer direct trading.</p><div className="identity-meta"><span>Public reputation record</span><span className="meta-separator">•</span><span>Reviews moderated before publishing</span></div></div><div className="profile-stamp" aria-label="Reverlo verification summary"><span className="stamp-top">REVERLO VERIFIED</span><span className="stamp-initials">{brand.mark}</span><span className="stamp-bottom"><CheckIcon /> Publicly verifiable</span></div></section>
    <section className="stats" aria-label="Live reputation statistics">{stats.map((stat, index) => <article className="stat-card" key={stat.label}><span className="stat-index">0{index + 1}</span><strong>{stat.value}</strong><h2>{stat.label}</h2><p>{stat.detail}</p></article>)}</section>
    <section className="content-section profile-section" id="profiles" aria-labelledby="profiles-heading"><div className="section-heading"><div><p className="section-kicker">Verified profiles</p><h2 id="profiles-heading">Official socials</h2></div></div>{socials.length ? <div className="profile-grid">{socials.map((profile, index) => <a href={profile.url} target="_blank" rel="noopener noreferrer" key={profile.id} className="profile-card"><span className={`platform-symbol platform-${index}`}>{socialMark(profile.platform)}</span><span className="profile-card-copy"><strong>{profile.platform}</strong><small>{new URL(profile.url).hostname}</small></span><span className="profile-kind">Official profile <span className="external-arrow" aria-hidden="true">↗</span></span></a>)}</div> : <div className="empty-panel"><span>—</span><p>No official profile links are published yet.</p></div>}</section>
    <section className="content-section vouches-section" id="reviews" aria-labelledby="reviews-heading"><div className="section-heading"><div><p className="section-kicker">Buyer references</p><h2 id="reviews-heading">Approved reviews</h2></div></div>{reputation.approvedReviews.length ? <div className="vouch-grid">{reputation.approvedReviews.map((review) => <article className="vouch-card" key={`${review.source}-${review.reviewId}`}><div className="vouch-card-top"><div><span className="vouch-avatar">{review.username.slice(0, 1).toUpperCase()}</span><span><strong>{review.username}</strong><small>{review.source === "EBAY" ? `eBay · ${review.feedbackType ?? "Feedback"}` : `${review.platform} · ${formatDate(review.createdAt)}`}</small></span></div><span className="vouch-ref">{review.source === "EBAY" ? "EBAY" : review.reviewId}</span></div>{review.review ? <p>“{review.review}”</p> : <p className="no-comment">No written eBay comment was provided.</p>}<span className="public-review-deal">{review.source === "EBAY" ? review.productDeal || "eBay feedback" : `${review.productDeal} · ${review.rating}/5`}</span></article>)}</div> : <div className="empty-panel"><span>—</span><p>No approved buyer reviews yet.</p></div>}</section>
    <section className="legit-check" id="verify" aria-labelledby="verify-heading"><div className="legit-copy"><p className="section-kicker">Legit check</p><h2 id="verify-heading">Make sure you’re speaking with the real profile.</h2><p>Before sending payment, compare the account you are messaging with the official profiles listed on this page. Do not rely on screenshots or matching display names alone.</p></div><div className="official-accounts"><span className="official-label">Official profiles</span>{socials.length ? socials.slice(0, 3).map((profile) => <a href={profile.url} target="_blank" rel="noopener noreferrer" className="official-row" key={profile.id}><span>{profile.platform}</span><strong>{new URL(profile.url).hostname}</strong></a>) : <p className="official-empty">Official profile links have not been published yet.</p>}</div></section>
    <footer><span>© {new Date().getFullYear()} Reverlo</span><span>Independent reputation profile</span><a href="#top">Back to top ↑</a><a href="/privacy">Privacy</a></footer>
  </div></main>;
}
