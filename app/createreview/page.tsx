"use client";

import { type FormEvent, useState } from "react";

const platforms = ["Discord", "X", "eBay", "Direct"];

function makeReviewId(sequence: number) {
  return `REV-${String(sequence).padStart(4, "0")}`;
}

export default function CreateReviewPage() {
  const [rating, setRating] = useState(0);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [nextSequence, setNextSequence] = useState(1);

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reviewId = makeReviewId(nextSequence);
    setSubmittedId(reviewId);
    setNextSequence((current) => current + 1);
    event.currentTarget.reset();
    setRating(0);
  }

  return (
    <main>
      <div className="page-shell review-page-shell">
        <header className="site-header">
          <a className="wordmark" href="/" aria-label="Return to Robert Tacchini reputation profile">
            <span className="wordmark-mark">RT</span>
            <span>Reputation <i>Profile</i></span>
          </a>
          <nav aria-label="Primary navigation">
            <a href="/#deals">Deals</a>
            <a href="/#vouches">Vouches</a>
            <a href="/#verify">Legit check</a>
          </nav>
          <a className="header-cta" href="/">View profile <span aria-hidden="true">←</span></a>
        </header>

        <section className="review-hero">
          <p className="section-kicker">Buyer reference</p>
          <h1>Leave a review.</h1>
          <p>Share a concise, honest reference about a completed deal. A review reference is generated automatically after submission.</p>
        </section>

        <section className="review-layout" aria-labelledby="review-form-heading">
          <aside className="review-sidebar">
            <span className="review-step">01</span>
            <h2 id="review-form-heading">Your deal reference</h2>
            <p>Only submit feedback for a genuine completed transaction. Do not include private contact, payment, delivery, or address information.</p>
            <div className="review-security-note"><span className="check-icon" aria-hidden="true">✓</span><span>Review IDs are generated automatically and cannot be selected by the reviewer.</span></div>
          </aside>

          <div className="review-panel">
            {submittedId ? <div className="review-success" role="status">
              <span className="check-icon" aria-hidden="true">✓</span>
              <div><strong>Review received locally</strong><p>Your reference ID is <code>{submittedId}</code>. It has not been published or stored yet.</p></div>
            </div> : null}

            <form className="review-form" onSubmit={submitReview}>
              <div className="form-row two-columns">
                <label>Username or name<input name="reviewer" type="text" autoComplete="name" placeholder="e.g. @buyerhandle" required /></label>
                <label>Platform<select name="platform" defaultValue="" required><option value="" disabled>Select platform</option>{platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select></label>
              </div>

              <fieldset className="rating-fieldset">
                <legend>Rating</legend>
                <div className="star-picker" aria-label="Choose a rating from one to five stars">
                  {[1, 2, 3, 4, 5].map((value) => <label className={rating >= value ? "star selected" : "star"} key={value}>
                    <input type="radio" name="rating" value={value} checked={rating === value} onChange={() => setRating(value)} required />
                    <span aria-hidden="true">★</span><span className="sr-only">{value} {value === 1 ? "star" : "stars"}</span>
                  </label>)}
                  <span className="rating-label">{rating ? `${rating} of 5` : "Select a rating"}</span>
                </div>
              </fieldset>

              <label>Product or deal<input name="deal" type="text" placeholder="e.g. Starlink Mini x3" required /></label>
              <label>Review or comment<textarea name="comment" placeholder="What went well with the transaction?" rows={5} required /></label>

              <div className="submit-row"><p>By submitting, you confirm this is your genuine experience.</p><button type="submit">Submit review <span aria-hidden="true">→</span></button></div>
            </form>
          </div>
        </section>

        <footer><span>© {new Date().getFullYear()} Robert Tacchini</span><span>Reputation profile · Denmark</span><a href="/">Return to profile ←</a></footer>
      </div>
    </main>
  );
}
