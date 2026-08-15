import { env } from "cloudflare:workers";
import type { ReviewPlatform } from "../app/data/seller";

export type PublicReviewLink = {
  productDeal: string;
  defaultPlatform: ReviewPlatform | null;
  dealType: "SALE" | "PURCHASE" | null;
  usedAt: string | null;
};

export async function getPublicReviewLink(token: string) {
  if (!env.DB || !/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;

  const link = await env.DB
    .prepare("SELECT product_deal AS productDeal, default_platform AS defaultPlatform, deal_type AS dealType, used_at AS usedAt FROM review_links WHERE token = ?")
    .bind(token)
    .first<PublicReviewLink>();

  return link ?? null;
}
