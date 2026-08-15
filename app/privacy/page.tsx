import type { Metadata } from "next";
import { ReverloWordmark } from "../components/ReverloWordmark";

export const metadata: Metadata = {
  title: "Privacy Policy — Reverlo",
  description: "Reverlo privacy policy, including information about eBay OAuth and feedback imports.",
};

export default function PrivacyPage() {
  return <main><div className="page-shell policy-shell">
    <header className="site-header"><a className="wordmark" href="/" aria-label="Reverlo home"><ReverloWordmark /></a><nav aria-label="Primary navigation"><a href="/#reviews">Reviews</a><a href="/#profiles">Profiles</a><a href="/#verify">Legit check</a></nav><a className="header-cta" href="/">Back to Reverlo <span aria-hidden="true">→</span></a></header>

    <article className="policy-content">
      <p className="section-kicker">Legal</p><h1>Privacy Policy.</h1><p className="policy-updated">Last updated: August 2026</p>
      <p className="policy-intro">This Privacy Policy explains how Reverlo processes information in connection with its public reputation profile, review tools, and optional eBay feedback integration.</p>

      <section><h2>Overview</h2><p>Reverlo provides a public reputation profile for moderated buyer references and official social profiles. Reviews submitted through an issued one-time review link are stored for moderation. Only reviews approved by Reverlo are displayed publicly.</p></section>

      <section><h2>eBay OAuth connection</h2><p>Reverlo can use eBay OAuth to connect to the owner&apos;s eBay account. This connection is used only where necessary for Reverlo functionality, including importing relevant seller feedback for display on the Reverlo profile.</p><p>Reverlo never receives or stores the owner&apos;s eBay password. OAuth access tokens, refresh tokens, and other eBay credentials are handled server-side and are not exposed on the public website.</p></section>

      <section><h2>Information we may process</h2><p>For reviews submitted through Reverlo, this may include the submitted username, rating, written review, product or deal description, selected platform, review identifier, and submission date.</p><p>When eBay feedback import is connected, Reverlo may process feedback data returned by eBay that is relevant to feedback received as a seller or buyer, such as the eBay feedback ID, commenter username or public user ID, feedback comment, Positive/Neutral/Negative feedback type, feedback date, and item or listing information when eBay provides it. Reverlo does not invent information that eBay does not return.</p></section>

      <section><h2>Why we use this information</h2><p>Reverlo uses this information to operate the reputation profile, moderate submitted reviews, show approved reviews publicly, import and display relevant eBay seller feedback, prevent duplicate imports, and allow the owner to manage locally displayed feedback.</p></section>

      <section><h2>Storage, retention, and removal</h2><p>Review and imported-feedback records are stored in Reverlo&apos;s database so that the profile and moderation tools can function. Reverlo reviews can be permanently removed by the owner through the admin area. Imported eBay feedback can be hidden from Reverlo; hiding it does not delete or alter the feedback on eBay, and Reverlo keeps the local record so that later syncs do not display it again.</p><p>Reverlo does not publish pending or rejected Reverlo reviews. Approved Reverlo reviews and non-hidden imported eBay feedback may be displayed on the public profile. This policy does not state a fixed retention period because the current implementation does not automatically delete these records after a set time.</p></section>

      <section><h2>Third-party services</h2><p>Reverlo&apos;s optional eBay integration uses eBay&apos;s services and APIs to obtain seller feedback that the connected account authorizes eBay to provide. eBay&apos;s handling of data is governed by eBay&apos;s own terms and privacy documentation. Reverlo does not sell eBay-derived data to third parties.</p></section>

      <section><h2>Contact and privacy questions</h2><p>Reverlo does not currently publish a dedicated privacy contact email on this website. If a public contact channel is added, this policy will be updated to include it.</p></section>
    </article>

    <footer><span>© {new Date().getFullYear()} Reverlo</span><span>Independent reputation profile</span><a href="/">Back to home ↑</a><a href="/privacy" aria-current="page">Privacy</a></footer>
  </div></main>;
}
