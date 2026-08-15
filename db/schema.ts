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
    // Null preserves existing reviews whose transaction direction is unknown.
    dealType: text("deal_type", { enum: ["SALE", "PURCHASE"] }),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    source: text("source", { enum: ["REVERLO"] }).notNull().default("REVERLO"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("reviews_review_id_unique").on(table.reviewId),
    uniqueIndex("reviews_submission_token_unique").on(table.submissionToken),
  ],
);

// Imported eBay feedback deliberately lives separately from reviews. Its
// Positive/Neutral/Negative type is retained and mapped deterministically to
// 5/3/1 stars only when Reverlo presents or aggregates it.
export const ebayFeedback = sqliteTable(
  "ebay_feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ebayFeedbackId: text("ebay_feedback_id").notNull(),
    username: text("username").notNull(),
    comment: text("comment").notNull().default(""),
    feedbackType: text("feedback_type").notNull(),
    itemId: text("item_id"),
    itemTitle: text("item_title"),
    receivedAt: text("received_at").notNull(),
    hiddenAt: text("hidden_at"),
    source: text("source", { enum: ["EBAY"] }).notNull().default("EBAY"),
    feedbackRole: text("feedback_role", { enum: ["SELLER", "BUYER"] }).notNull().default("SELLER"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("ebay_feedback_source_id_unique").on(table.ebayFeedbackId)],
);

export const ebaySyncState = sqliteTable("ebay_sync_state", {
  id: integer("id").primaryKey(),
  lastSyncAt: text("last_sync_at"),
  lastSuccessAt: text("last_success_at"),
  importedCount: integer("imported_count").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reviewLinks = sqliteTable(
  "review_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    token: text("token").notNull(),
    productDeal: text("product_deal").notNull(),
    defaultPlatform: text("default_platform", { enum: ["Discord", "X", "eBay", "Direct"] }),
    // New links always receive a type; null is retained for pre-existing links.
    dealType: text("deal_type", { enum: ["SALE", "PURCHASE"] }),
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
