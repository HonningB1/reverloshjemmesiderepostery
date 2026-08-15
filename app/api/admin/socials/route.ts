import { env } from "cloudflare:workers";
import { socialPlatforms, type SocialPlatform } from "../../../data/seller";

type SocialProfile = { id: number; platform: SocialPlatform; url: string; createdAt: string; updatedAt: string };

function cleanUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && socialPlatforms.includes(value as SocialPlatform);
}

function unavailable() {
  return Response.json({ error: "Profile settings are not initialized yet." }, { status: 503 });
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("no such table") || message.includes("social_profiles");
}

export async function GET() {
  if (!env.DB) return unavailable();
  try {
    const result = await env.DB.prepare("SELECT id, platform, url, created_at AS createdAt, updated_at AS updatedAt FROM social_profiles ORDER BY id ASC").all<SocialProfile>();
    return Response.json({ socials: result.results });
  } catch (error) {
    if (databaseError(error)) return unavailable();
    return Response.json({ error: "Unable to load social profiles." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!env.DB) return unavailable();
  try {
    const payload = (await request.json()) as { platform?: unknown; url?: unknown };
    const url = cleanUrl(payload.url);
    if (!isPlatform(payload.platform) || !url) return Response.json({ error: "Choose a supported platform and a valid https:// URL." }, { status: 400 });

    const social = await env.DB.prepare(
      "INSERT INTO social_profiles (platform, url) VALUES (?, ?) RETURNING id, platform, url, created_at AS createdAt, updated_at AS updatedAt",
    ).bind(payload.platform, url).first<SocialProfile>();
    return Response.json({ social }, { status: 201 });
  } catch (error) {
    if (databaseError(error)) return unavailable();
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed")) return Response.json({ error: "That platform already has a configured profile." }, { status: 409 });
    return Response.json({ error: "Unable to save the social profile." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!env.DB) return unavailable();
  try {
    const payload = (await request.json()) as { id?: unknown; platform?: unknown; url?: unknown };
    const id = Number(payload.id);
    const url = cleanUrl(payload.url);
    if (!Number.isInteger(id) || id < 1 || !isPlatform(payload.platform) || !url) return Response.json({ error: "Choose a supported platform and a valid https:// URL." }, { status: 400 });

    const social = await env.DB.prepare(
      "UPDATE social_profiles SET platform = ?, url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING id, platform, url, created_at AS createdAt, updated_at AS updatedAt",
    ).bind(payload.platform, url, id).first<SocialProfile>();
    if (!social) return Response.json({ error: "This social profile no longer exists." }, { status: 404 });
    return Response.json({ social });
  } catch (error) {
    if (databaseError(error)) return unavailable();
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed")) return Response.json({ error: "That platform already has a configured profile." }, { status: 409 });
    return Response.json({ error: "Unable to update the social profile." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!env.DB) return unavailable();
  try {
    const payload = (await request.json()) as { id?: unknown };
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid social profile." }, { status: 400 });
    const result = await env.DB.prepare("DELETE FROM social_profiles WHERE id = ?").bind(id).run();
    if (result.meta.changes !== 1) return Response.json({ error: "This social profile no longer exists." }, { status: 404 });
    return Response.json({ id });
  } catch (error) {
    if (databaseError(error)) return unavailable();
    return Response.json({ error: "Unable to remove the social profile." }, { status: 500 });
  }
}
