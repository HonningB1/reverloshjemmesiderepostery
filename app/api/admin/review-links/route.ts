import { env } from "cloudflare:workers";
import { reviewPlatforms } from "../../../data/seller";

type AdminReviewLink = {
  id: number;
  token: string;
  productDeal: string;
  defaultPlatform: string | null;
  createdAt: string;
  usedAt: string | null;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function makeSecureToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function unavailable() {
  return Response.json({ error: "Review storage is not initialized yet." }, { status: 503 });
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("no such table") || message.includes("review_links");
}

// Cloudflare Access protects this /api/admin/* route at the edge.
export async function GET() {
  if (!env.DB) return unavailable();

  try {
    const result = await env.DB.prepare(
      `SELECT id, token, product_deal AS productDeal, default_platform AS defaultPlatform,
              created_at AS createdAt, used_at AS usedAt
       FROM review_links ORDER BY id DESC`,
    ).all<AdminReviewLink>();

    return Response.json({ links: result.results.map((link) => ({ ...link, status: link.usedAt ? "USED" : "ACTIVE", path: `/review/${link.token}` })) });
  } catch (error) {
    if (databaseError(error)) return unavailable();
    return Response.json({ error: "Unable to load review links." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!env.DB) return unavailable();

  try {
    const payload = (await request.json()) as { productDeal?: unknown; defaultPlatform?: unknown };
    const productDeal = cleanText(payload.productDeal, 160);
    const candidatePlatform = cleanText(payload.defaultPlatform, 32);
    const defaultPlatform = candidatePlatform || null;

    if (!productDeal || (defaultPlatform && !reviewPlatforms.includes(defaultPlatform as (typeof reviewPlatforms)[number]))) {
      return Response.json({ error: "Enter a product/deal and a valid optional platform." }, { status: 400 });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = makeSecureToken();
      try {
        const inserted = await env.DB
          .prepare("INSERT INTO review_links (token, product_deal, default_platform) VALUES (?, ?, ?) RETURNING id, token, product_deal AS productDeal, default_platform AS defaultPlatform, created_at AS createdAt, used_at AS usedAt")
          .bind(token, productDeal, defaultPlatform)
          .first<AdminReviewLink>();

        if (inserted) return Response.json({ link: { ...inserted, status: "ACTIVE", path: `/review/${inserted.token}` } }, { status: 201 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("UNIQUE constraint failed")) throw error;
      }
    }

    return Response.json({ error: "Unable to create a unique review link. Please try again." }, { status: 503 });
  } catch (error) {
    if (databaseError(error)) return unavailable();
    return Response.json({ error: "Unable to create the review link." }, { status: 500 });
  }
}
