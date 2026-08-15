export const brand = {
  name: "Reverlo",
  mark: "RV",
  availability: "Active reputation profile",
} as const;

export const socialPlatforms = ["eBay", "Discord", "Instagram", "X/Twitter", "Facebook", "TikTok", "YouTube", "Website"] as const;
export type SocialPlatform = (typeof socialPlatforms)[number];

export const reviewPlatforms = ["Discord", "X", "eBay", "Direct"] as const;
export type ReviewPlatform = (typeof reviewPlatforms)[number];
