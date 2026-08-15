import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const reviewCounters = sqliteTable("review_counters", {
  name: text("name").primaryKey(),
  currentValue: integer("current_value").notNull().default(0),
});

export const reviews = sqliteTable(
  "reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reviewId: text("review_id").notNull(),
    submissionToken: text("submission_token").notNull(),
    reviewLinkId: integer("review_link_id"),
    username: text("username").notNull(),
    rating: integer("rating").notNull(),
    review: text("review").notNull(),
    productDeal: text("product_deal").notNull(),
    platform: text("platform", { enum: ["Discord", "X", "eBay", "Direct"] }).notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("reviews_review_id_unique").on(table.reviewId),
    uniqueIndex("reviews_submission_token_unique").on(table.submissionToken),
  ],
);

export const reviewLinks = sqliteTable(
  "review_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    token: text("token").notNull(),
    productDeal: text("product_deal").notNull(),
    defaultPlatform: text("default_platform", { enum: ["Discord", "X", "eBay", "Direct"] }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    usedAt: text("used_at"),
  },
  (table) => [uniqueIndex("review_links_token_unique").on(table.token)],
);

export const socialProfiles = sqliteTable(
  "social_profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    platform: text("platform", { enum: ["eBay", "Discord", "Instagram", "X/Twitter", "Facebook", "TikTok", "YouTube", "Website"] }).notNull(),
    url: text("url").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("social_profiles_platform_unique").on(table.platform)],
);
