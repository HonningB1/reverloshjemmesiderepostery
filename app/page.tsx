"use client";

import { useMemo, useState } from "react";
import { deals, profiles, seller, vouches } from "./data/seller";
import { ExternalLink } from "./components/ExternalLink";

function CheckIcon() {
  return <span className="check-icon" aria-hidden="true">✓</span>;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const visibleDeals = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return deals;
    return deals.filter((deal) => `${deal.id} ${deal.product} ${deal.destination} ${deal.status}`.toLowerCase().includes(term));
  }, [query]);

  return (
    <main>
      <div className="page-shell">
        <header className="site-header">
          <a className="wordmark" href="#top" aria-label="Robert Tacchini reputation profile">
            <span className="wordmark-mark">RT</span>
            <span>Reputation <i>Profile</i></span>
          </a>
          <nav aria-label="Primary navigation">
            <a href="#deals">Deals</a>
            <a href="#vouches">Vouches</a>
            <a href="#verify">Legit check</a>
          </nav>
          <a className="header-cta" href="#verify">Verify seller <span aria-hidden="true">↓</span></a>
        </header>

        <section className="notice" aria-label="Setup notice">
          <span className="notice-dot" /> Sample profile data is shown. Replace every sample record and official account before sharing this site.
        </section>

        <section className="hero" id="top">
          <div className="identity-block">
            <div className="status-line"><span className="pulse-dot" /> {seller.availability}</div>
            <p className="eyebrow">Independent seller · {seller.location} <span aria-hidden="true">🇩🇰</span></p>
            <h1>{seller.name}</h1>
            <p className="hero-copy">A transparent record of completed deals, public references, and the official accounts used for direct trading.</p>
            <div className="identity-meta">
              <span>Trading since {seller.since}</span><span className="meta-separator">•</span><span>Identity reference <strong>RTC</strong></span>
            </div>
          </div>
          <div className="profile-stamp" aria-label="Seller verification summary">
            <span className="stamp-top">SELLER REFERENCE</span>
            <span className="stamp-initials">{seller.initials}</span>
            <span className="stamp-bottom"><CheckIcon /> Publicly verifiable</span>
          </div>
        </section>

        <section className="stats" aria-label="Seller statistics">
          {seller.stats.map((stat, index) => <article className="stat-card" key={stat.label}>
            <span className="stat-index">0{index + 1}</span>
            <strong>{stat.value}</strong>
            <h2>{stat.label}</h2>
            <p>{stat.detail}</p>
          </article>)}
        </section>

        <section className="content-section profile-section" aria-labelledby="profiles-heading">
          <div className="section-heading"><div><p className="section-kicker">Independent verification</p><h2 id="profiles-heading">Verified profiles</h2></div><p>Links below open the external platforms where these accounts can be independently checked.</p></div>
          <div className="profile-grid">
            {profiles.map((profile, index) => <ExternalLink href={profile.url} key={profile.platform} className="profile-card" label={`Open official ${profile.platform} profile`}>
              <span className={`platform-symbol platform-${index}`}>{profile.platform.slice(0, 1)}</span>
              <span className="profile-card-copy"><strong>{profile.platform}</strong><small>{profile.handle}</small></span>
              <span className="profile-kind">{profile.kind}</span>
            </ExternalLink>)}
          </div>
          <p className="source-note"><CheckIcon /> <strong>How this works:</strong> Profile links are external sources. Deal history and vouches below are reported on this site and should be checked against their linked proof.</p>
        </section>

        <section className="content-section deals-section" id="deals" aria-labelledby="deals-heading">
          <div className="section-heading deal-heading"><div><p className="section-kicker">Trading record</p><h2 id="deals-heading">Recent completed deals</h2></div><label className="deal-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a deal ID" aria-label="Search deal records" /></label></div>
          <div className="deal-table-wrap">
            <table>
              <thead><tr><th>Deal reference</th><th>Item</th><th>Buyer</th><th>Route</th><th>Date</th><th>Status</th></tr></thead>
              <tbody>{visibleDeals.map((deal) => <tr key={deal.id}>
                <td><span className="deal-id">{deal.id}</span>{deal.proofUrl && <ExternalLink href={deal.proofUrl} className="proof-link" label={`Open proof for ${deal.id}`}>Proof</ExternalLink>}</td>
                <td><strong>{deal.product} <span className="quantity">×{deal.quantity}</span></strong><small>{deal.price}</small></td>
                <td>{deal.buyer}</td>
                <td><span className="route">{deal.origin} <b>→</b> {deal.destination}</span></td>
                <td>{deal.date}</td>
                <td><span className="deal-status"><CheckIcon /> {deal.status}</span></td>
              </tr>)}</tbody>
            </table>
            {visibleDeals.length === 0 && <p className="empty-state">No deal record matches “{query}”. Check the reference ID and try again.</p>}
          </div>
          <p className="privacy-note">Only high-level transaction information is listed here. Private buyer details, payment information, addresses, and tracking numbers are never published.</p>
        </section>

        <section className="content-section vouches-section" id="vouches" aria-labelledby="vouches-heading">
          <div className="section-heading"><div><p className="section-kicker">Buyer references</p><h2 id="vouches-heading">Vouches with a source</h2></div><p>These are references, not anonymous star ratings. Where available, the original public vouch is linked.</p></div>
          <div className="vouch-grid">{vouches.map((vouch) => <article className="vouch-card" key={`${vouch.buyer}-${vouch.dealId}`}>
            <div className="vouch-card-top"><div><span className="vouch-avatar">{vouch.buyer.replace("@", "").slice(0, 1).toUpperCase()}</span><span><strong>{vouch.buyer}</strong><small>{vouch.platform} · {vouch.date}</small></span></div><span className="vouch-ref">{vouch.dealId}</span></div>
            <p>“{vouch.comment}”</p>
            {vouch.url ? <ExternalLink href={vouch.url} className="vouch-link">View original vouch</ExternalLink> : <span className="unlinked-vouch">No public source link</span>}
          </article>)}</div>
        </section>

        <section className="legit-check" id="verify" aria-labelledby="verify-heading">
          <div className="legit-copy"><p className="section-kicker">Legit check</p><h2 id="verify-heading">Make sure you’re speaking with the real seller.</h2><p>Before sending payment, compare the account you are messaging with the official accounts listed on this page. Do not rely on screenshots or matching display names alone.</p></div>
          <div className="official-accounts"><span className="official-label">Official accounts</span>{profiles.slice(0, 3).map((profile) => <ExternalLink href={profile.url} className="official-row" key={profile.platform}><span>{profile.platform}</span><strong>{profile.handle}</strong></ExternalLink>)}</div>
        </section>

        <footer><span>© {new Date().getFullYear()} {seller.name}</span><span>Reputation profile · Denmark</span><a href="#top">Back to top ↑</a></footer>
      </div>
    </main>
  );
}
