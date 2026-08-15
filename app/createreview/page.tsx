import { brand } from "../data/seller";

export const metadata = { title: "Review links only | Reverlo" };

export default function CreateReviewPage() {
  return <main><div className="page-shell review-page-shell">
    <header className="site-header"><a className="wordmark" href="/" aria-label="Return to Reverlo"><span className="wordmark-mark">{brand.mark}</span><span>{brand.name}</span></a><a className="header-cta" href="/">View Reverlo <span aria-hidden="true">←</span></a></header>
    <section className="review-link-state"><p className="section-kicker">Review links only</p><h1>Reviews need a secure link.</h1><p>To protect the reputation record, new reviews can only be submitted through a seller-issued one-time Reverlo review link.</p><a className="header-cta" href="/">Return to Reverlo <span aria-hidden="true">←</span></a></section>
    <footer><span>© {new Date().getFullYear()} Reverlo</span><span>Independent reputation profile</span></footer>
  </div></main>;
}
