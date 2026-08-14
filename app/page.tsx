import { getPublicReviewData } from "../db/reviews";
import { profiles, seller } from "./data/seller";

export const dynamic = "force-dynamic";

function CheckIcon() {
  return <span className="check-icon" aria-hidden="true">✓</span>;
}

function formatDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export default async function Home() {
  const reputation = await getPublicReviewData().catch(() => ({
    summary: { approvedCount: 0, averageRating: 0, platformCount: 0 },
    approvedReviews: [],
  }));
  const stats = [
    { label: "Approved reviews", value: String(reputation.summary.approvedCount), detail: "Public buyer references" },
    { label: "Average rating", value: reputation.summary.approvedCount ? `${reputation.summary.averageRating.toFixed(1)} / 5` : "—", detail: "Approved reviews only" },
    { label: "Platforms", value: String(reputation.summary.platformCount), detail: "With approved references" },
    { label: "Public status", value: "Verified", detail: "Pending reviews stay private" },
  ];

  return <main><div className="page-shell">
    <header className="site-header">
      <a className="wordmark" href="#top" aria-label="Robert Tacchini reputation profile"><span className="wordmark-mark">RT</span><span>Reputation <i>Profile</i></span></a>
      <nav aria-label="Primary navigation"><a href="#reviews">Reviews</a><a href="#deals">Deals</a><a href="#verify">Legit check</a></nav>
      <a className="header-cta" href="/createreview">Leave a review <span aria-hidden="true">→</span></a>
    </header>

    <section className="hero" id="top">
      <div className="identity-block"><div className="status-line"><span className="pulse-dot" /> {seller.availability}</div><p className="eyebrow">Independent seller · {seller.location} <span aria-hidden="true">🇩🇰</span></p><h1>{seller.name}</h1><p className="hero-copy">A transparent record of publicly approved buyer references and the official accounts used for direct trading.</p><div className="identity-meta"><span>Trading since {seller.since}</span><span className="meta-separator">•</span><span>Identity reference <strong>RTC</strong></span></div></div>
      <div className="profile-stamp" aria-label="Seller verification summary"><span className="stamp-top">SELLER REFERENCE</span><span className="stamp-initials">{seller.initials}</span><span className="stamp-bottom"><CheckIcon /> Publicly verifiable</span></div>
    </section>

    <section className="stats" aria-label="Live reputation statistics">{stats.map((stat, index) => <article className="stat-card" key={stat.label}><span className="stat-index">0{index + 1}</span><strong>{stat.value}</strong><h2>{stat.label}</h2><p>{stat.detail}</p></article>)}</section>

    <section className="content-section profile-section" aria-labelledby="profiles-heading"><div className="section-heading"><div><p className="section-kicker">Independent verification</p><h2 id="profiles-heading">Verified profiles</h2></div><p>Official accounts are listed only after their public URLs are ready to be independently checked.</p></div>
      {profiles.length ? <div className="profile-grid">{profiles.map((profile, index) => <a href={profile.url} target="_blank" rel="noopener noreferrer" key={profile.platform} className="profile-card"><span className={`platform-symbol platform-${index}`}>{profile.platform.slice(0, 1)}</span><span className="profile-card-copy"><strong>{profile.platform}</strong><small>{profile.handle}</small></span><span className="profile-kind">{profile.kind}</span></a>)}</div> : <div className="empty-panel"><span>—</span><p>No official profile links are published yet.</p></div>}
    </section>

    <section className="content-section deals-section" id="deals" aria-labelledby="deals-heading"><div className="section-heading"><div><p className="section-kicker">Trading record</p><h2 id="deals-heading">Completed deals</h2></div><p>Deal records are published only when verified data is available. Private transaction details are never displayed.</p></div><div className="empty-panel"><span>—</span><p>No completed deal records are published yet.</p></div></section>

    <section className="content-section vouches-section" id="reviews" aria-labelledby="reviews-heading"><div className="section-heading"><div><p className="section-kicker">Buyer references</p><h2 id="reviews-heading">Approved reviews</h2></div><p>Only reviews approved by the seller are visible here. Pending and rejected reviews remain private.</p></div>
      {reputation.approvedReviews.length ? <div className="vouch-grid">{reputation.approvedReviews.map((review) => <article className="vouch-card" key={review.reviewId}><div className="vouch-card-top"><div><span className="vouch-avatar">{review.username.slice(0, 1).toUpperCase()}</span><span><strong>{review.username}</strong><small>{review.platform} · {formatDate(review.createdAt)}</small></span></div><span className="vouch-ref">{review.reviewId}</span></div><p>“{review.review}”</p><span className="public-review-deal">{review.productDeal} · {review.rating}/5</span></article>)}</div> : <div className="empty-panel"><span>—</span><p>No approved buyer reviews yet.</p></div>}
    </section>

    <section className="legit-check" id="verify" aria-labelledby="verify-heading"><div className="legit-copy"><p className="section-kicker">Legit check</p><h2 id="verify-heading">Make sure you’re speaking with the real seller.</h2><p>Before sending payment, compare the account you are messaging with the official accounts listed on this page. Do not rely on screenshots or matching display names alone.</p></div><div className="official-accounts"><span className="official-label">Official accounts</span>{profiles.length ? profiles.slice(0, 3).map((profile) => <a href={profile.url} target="_blank" rel="noopener noreferrer" className="official-row" key={profile.platform}><span>{profile.platform}</span><strong>{profile.handle}</strong></a>) : <p className="official-empty">Official account links have not been published yet.</p>}</div></section>
    <footer><span>© {new Date().getFullYear()} {seller.name}</span><span>Reputation profile · Denmark</span><a href="#top">Back to top ↑</a></footer>
  </div></main>;
}
