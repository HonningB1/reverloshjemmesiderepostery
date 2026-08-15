"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { reviewPlatforms, type ReviewPlatform } from "../../data/seller";

type Props = { token: string; productDeal: string; defaultPlatform: ReviewPlatform | null };

export default function ReviewForm({ token, productDeal, defaultPlatform }: Props) {
  const [rating, setRating] = useState(0);
  const [platform, setPlatform] = useState<ReviewPlatform | "">(defaultPlatform ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, defaultPlatform ? reviewPlatforms.indexOf(defaultPlatform) : 0));
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = "review-platform-options";

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (isOpen) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, isOpen]);

  function choosePlatform(value: ReviewPlatform, index: number) {
    setPlatform(value);
    setActiveIndex(index);
    setIsOpen(false);
  }

  function handleDropdownKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") { event.preventDefault(); setIsOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (event.key === "ArrowDown" ? (current + 1) % reviewPlatforms.length : (current - 1 + reviewPlatforms.length) % reviewPlatforms.length));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); setIsOpen(true); setActiveIndex(event.key === "Home" ? 0 : reviewPlatforms.length - 1); return;
    }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setIsOpen((open) => !open); }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, value: ReviewPlatform, index: number) {
    if (event.key === "Escape") { event.preventDefault(); setIsOpen(false); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choosePlatform(value, index); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setActiveIndex(event.key === "ArrowDown" ? (index + 1) % reviewPlatforms.length : (index - 1 + reviewPlatforms.length) % reviewPlatforms.length); return;
    }
    if (event.key === "Home" || event.key === "End") { event.preventDefault(); setActiveIndex(event.key === "Home" ? 0 : reviewPlatforms.length - 1); }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSubmittedId(null); setSubmissionError(null);
    if (!platform) { setSubmissionError("Choose the platform used for the deal."); return; }
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/review/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ username: values.get("reviewer"), rating, review: values.get("comment"), platform }),
      });
      const result = (await response.json()) as { reviewId?: string; error?: string };
      if (!response.ok || !result.reviewId) throw new Error(result.error ?? "Unable to submit the review.");
      setSubmittedId(result.reviewId); form.reset(); setRating(0);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Unable to submit the review.");
    } finally { setIsSubmitting(false); }
  }

  return <section className="review-layout" aria-labelledby="review-form-heading">
    <aside className="review-sidebar"><span className="review-step">01</span><h2 id="review-form-heading">Your deal reference</h2><p>This personal link is valid for one genuine completed transaction. Do not include private contact, payment, delivery, or address information.</p><div className="review-security-note"><span className="check-icon" aria-hidden="true">✓</span><span>The product or deal is fixed by the secure review link and cannot be changed.</span></div></aside>
    <div className="review-panel">
      {submittedId ? <div className="review-success" role="status"><span className="check-icon" aria-hidden="true">✓</span><div><strong>Review received for moderation</strong><p>Your reference ID is <code>{submittedId}</code>. It is stored as pending and is not public.</p></div></div> : null}
      {submissionError ? <p className="review-error" role="alert">{submissionError}</p> : null}
      {!submittedId ? <form className="review-form" onSubmit={submitReview}>
        <div className="form-row two-columns"><label>Username or name<input name="reviewer" type="text" autoComplete="name" placeholder="Your public username or name" required /></label>
          <div className="field-label"><span>Platform</span><div className="custom-select" ref={dropdownRef}>
            <button type="button" className="custom-select-trigger" aria-haspopup="listbox" aria-expanded={isOpen} aria-controls={listboxId} onClick={() => setIsOpen((open) => !open)} onKeyDown={handleDropdownKeyDown}>{platform || "Select platform"}<span aria-hidden="true">⌄</span></button>
            {isOpen ? <div className="custom-select-menu" id={listboxId} role="listbox" aria-label="Platform">{reviewPlatforms.map((value, index) => <button type="button" role="option" aria-selected={platform === value} className={platform === value ? "selected" : ""} key={value} ref={(element) => { optionRefs.current[index] = element; }} onClick={() => choosePlatform(value, index)} onKeyDown={(event) => handleOptionKeyDown(event, value, index)}>{value}<span aria-hidden="true">{platform === value ? "✓" : ""}</span></button>)}</div> : null}
          </div></div></div>
        <fieldset className="rating-fieldset"><legend>Rating</legend><div className="star-picker" aria-label="Choose a rating from one to five stars">{[1, 2, 3, 4, 5].map((value) => <label className={rating >= value ? "star selected" : "star"} key={value}><input type="radio" name="rating" value={value} checked={rating === value} onChange={() => setRating(value)} required /><span aria-hidden="true">★</span><span className="sr-only">{value} {value === 1 ? "star" : "stars"}</span></label>)}<span className="rating-label">{rating ? `${rating} of 5` : "Select a rating"}</span></div></fieldset>
        <label>Product or deal<input value={productDeal} readOnly aria-readonly="true" /></label>
        <label>Review or comment<textarea name="comment" placeholder="What went well with the transaction?" rows={5} required /></label>
        <div className="submit-row"><p>By submitting, you confirm this is your genuine experience. This link is used only after the review has been accepted.</p><button type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting..." : "Submit review"} <span aria-hidden="true">→</span></button></div>
      </form> : null}
    </div>
  </section>;
}
