import { getPublicSocialProfiles } from "../db/profile";
import { getPublicReviewData } from "../db/reviews";
import { brand, type SocialPlatform } from "./data/seller";
import { PublicReviewList } from "./PublicReviewList";

export const dynamic = "force-dynamic";

function CheckIcon() { return <span className="check-icon" aria-hidden="true">✓</span>; }

function socialMark(platform: SocialPlatform) {
  return { eBay: "e", Discord: "#", Instagram: "◎", "X/Twitter": "𝕏", Facebook: "f", TikTok: "♪", YouTube: "▶", Website: "↗" }[platform];
}

export default async function Home() {
  const [reputation, socials] = await Promise.all([
    getPublicReviewData().catch(() => ({ summary: { approvedCount: 0, reverloCount: 0, ebaySellerCount: 0, ebayBuyerCount: 0, averageRating: 0, platformCount: 0 }, approvedReviews: [] })),
    getPublicSocialProfiles().catch(() => []),
  ]);
  const stats = [
    { label: "Total feedback", value: String(reputation.summary.approvedCount), detail: "Reverlo reviews & eBay feedback" },
    { label: "eBay Seller feedback", value: String(reputation.summary.ebaySellerCount), detail: "Received as seller" },
    { label: "eBay Buyer feedback", value: String(reputation.summary.ebayBuyerCount), detail: "Received as buyer" },
    { label: "Average rating", value: reputation.summary.averageRating ? `${reputation.summary.averageRating.toFixed(1)} / 5` : "—", detail: "Reverlo reviews only" },
  ];

  return <main><div className="page-shell">
    <header className="site-header"><a className="wordmark" href="#top" aria-label="Reverlo home"><span className="wordmark-mark">{brand.mark}</span><span>{brand.name}</span></a><nav aria-label="Primary navigation"><a href="#reviews">Reviews</a><a href="#profiles">Profiles</a><a href="#verify">Legit check</a></nav><a className="header-cta" href="#verify">Verify a seller <span aria-hidden="true">→</span></a></header>
    <section className="hero" id="top"><div className="identity-block"><div className="status-line"><span className="pulse-dot" /> {brand.availability}</div><p className="eyebrow">Independent seller verification</p><h1>Reverlo.</h1><p className="hero-copy">A transparent record of approved Reverlo reviews, imported eBay feedback and verified social profiles for safer direct trading.</p><div className="identity-meta"><span>Public reputation record</span><span className="meta-separator">•</span><span>Reviews moderated before publishing</span></div></div><div className="profile-stamp" aria-label="Reverlo verification summary"><span className="stamp-top">REVERLO VERIFIED</span><span className="stamp-initials">{brand.mark}</span><span className="stamp-bottom"><CheckIcon /> Publicly verifiable</span></div></section>
    <section className="stats" aria-label="Live reputation statistics">{stats.map((stat, index) => <article className="stat-card" key={stat.label}><span className="stat-index">0{index + 1}</span><strong>{stat.value}</strong><h2>{stat.label}</h2><p>{stat.detail}</p></article>)}</section>
    <section className="content-section profile-section" id="profiles" aria-labelledby="profiles-heading"><div className="section-heading"><div><p className="section-kicker">Verified profiles</p><h2 id="profiles-heading">Official socials</h2></div></div>{socials.length ? <div className="profile-grid">{socials.map((profile, index) => <a href={profile.url} target="_blank" rel="noopener noreferrer" key={profile.id} className="profile-card"><span className={`platform-symbol platform-${index}`}>{socialMark(profile.platform)}</span><span className="profile-card-copy"><strong>{profile.platform}</strong><small>{new URL(profile.url).hostname}</small></span><span className="profile-kind">Official profile <span className="external-arrow" aria-hidden="true">↗</span></span></a>)}</div> : <div className="empty-panel"><span>—</span><p>No official profile links are published yet.</p></div>}</section>
    <section className="content-section vouches-section" id="reviews" aria-labelledby="reviews-heading"><div className="section-heading"><div><p className="section-kicker">Public feedback</p><h2 id="reviews-heading">Reviews &amp; feedback</h2></div></div><PublicReviewList reviews={reputation.approvedReviews} counts={{ reverlo: reputation.summary.reverloCount, ebaySeller: reputation.summary.ebaySellerCount, ebayBuyer: reputation.summary.ebayBuyerCount }} /></section>
    <section className="legit-check" id="verify" aria-labelledby="verify-heading"><div className="legit-copy"><p className="section-kicker">Legit check</p><h2 id="verify-heading">Make sure you’re speaking with the real profile.</h2><p>Before sending payment, compare the account you are messaging with the official profiles listed on this page. Do not rely on screenshots or matching display names alone.</p></div><div className="official-accounts"><span className="official-label">Official profiles</span>{socials.length ? socials.slice(0, 3).map((profile) => <a href={profile.url} target="_blank" rel="noopener noreferrer" className="official-row" key={profile.id}><span>{profile.platform}</span><strong>{new URL(profile.url).hostname}</strong></a>) : <p className="official-empty">Official profile links have not been published yet.</p>}</div></section>
    <footer><span>© {new Date().getFullYear()} Reverlo</span><span>Independent reputation profile</span><a href="#top">Back to top ↑</a><a href="/privacy">Privacy</a></footer>
  </div></main>;
}
