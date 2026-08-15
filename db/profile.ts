import { asc } from "drizzle-orm";
import { getDb } from ".";
import { socialProfiles } from "./schema";
import type { SocialPlatform } from "../app/data/seller";

export type PublicSocialProfile = {
  id: number;
  platform: SocialPlatform;
  url: string;
};

export async function getPublicSocialProfiles() {
  const db = getDb();
  const profiles = await db
    .select({ id: socialProfiles.id, platform: socialProfiles.platform, url: socialProfiles.url })
    .from(socialProfiles)
    .orderBy(asc(socialProfiles.id));

  return profiles as PublicSocialProfile[];
}
