import type { Metadata } from "next";
import { brand } from "../../data/seller";
import { getPublicReviewLink } from "../../../db/review-links";
import ReviewForm from "./ReviewForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Submit a review | Reverlo", description: "Submit a private buyer review using your Reverlo one-time review link." };

function Header() {
  return <header className="site-header"><a className="wordmark" href="/" aria-label="Return to Reverlo"><span className="wordmark-mark">{brand.mark}</span><span>{brand.name}</span></a><a className="header-cta" href="/">View Reverlo <span aria-hidden="true">←</span></a></header>;
}

export default async function ReviewLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await getPublicReviewLink(token).catch(() => null);

  if (!link || link.usedAt) return <main><div className="page-shell review-page-shell"><Header /><section className="review-link-state"><p className="section-kicker">Review link</p><h1>{link?.usedAt ? "This review link has already been used." : "This review link is not valid."}</h1><p>{link?.usedAt ? "Each Reverlo review link can be used for one successful submission only." : "Ask the seller for a new secure review link if you still need to leave feedback."}</p><a className="header-cta" href="/">Return to Reverlo <span aria-hidden="true">←</span></a></section><footer><span>© {new Date().getFullYear()} Reverlo</span><span>Independent reputation profile</span></footer></div></main>;

  return <main><div className="page-shell review-page-shell"><Header /><section className="review-hero"><p className="section-kicker">{link.dealType === "PURCHASE" ? "Purchase reference" : link.dealType === "SALE" ? "Sale reference" : "Deal reference"}</p><h1>Leave a review.</h1><p>Share a concise, honest reference about the completed deal below. A review reference is generated automatically after submission.</p></section><ReviewForm token={token} productDeal={link.productDeal} defaultPlatform={link.defaultPlatform} dealType={link.dealType} /><footer><span>© {new Date().getFullYear()} Reverlo</span><span>Independent reputation profile</span><a href="/">Return to Reverlo ←</a></footer></div></main>;
}
