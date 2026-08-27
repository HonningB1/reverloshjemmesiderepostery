"use client";

import { type ReactNode, useEffect, useId } from "react";

/**
 * The Tracker has several editing surfaces, but they intentionally share one
 * modal shell. Keeping focus, keyboard dismissal, spacing and the header in
 * one place prevents create and edit flows from drifting apart visually.
 */
export function TrackerModal({
  title,
  kicker,
  children,
  onClose,
  closeLabel,
  wide = false,
}: {
  title: string;
  kicker: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  wide?: boolean;
}) {
  const headingId = useId();
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return <div className="track-dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className={`track-dialog ${wide ? "track-dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <header><div><p className="track-kicker">{kicker}</p><h2 id={headingId}>{title}</h2></div><button type="button" className="track-dialog-close" onClick={onClose} aria-label={closeLabel}>×</button></header>
      {children}
    </section>
  </div>;
}
