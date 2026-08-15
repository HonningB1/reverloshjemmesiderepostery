import { ReverloWordmark } from "../components/ReverloWordmark";

export const metadata = { title: "Review links only | Reverlo" };

export default function CreateReviewPage() {
  return <main><div className="page-shell review-page-shell">
    <header className="site-header"><a className="wordmark" href="/" aria-label="Return to Reverlo"><ReverloWordmark /></a><a className="header-cta" href="/">View Reverlo <span aria-hidden="true">←</span></a></header>
    <section className="review-link-state"><p className="section-kicker">Review links only</p><h1>Reviews need a secure link.</h1><p>To protect the reputation record, new reviews can only be submitted through a seller-issued one-time Reverlo review link.</p><a className="header-cta" href="/">Return to Reverlo <span aria-hidden="true">←</span></a></section>
    <footer><span>© {new Date().getFullYear()} Reverlo</span><span>Independent reputation profile</span></footer>
  </div></main>;
}
