import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const trackerProducts = sqliteTable(
  "tracker_products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    remainingQuantity: integer("remaining_quantity").notNull(),
    purchasePriceOre: integer("purchase_price_ore").notNull(),
    purchaseShippingOre: integer("purchase_shipping_ore").notNull().default(0),
    expectedSalePriceOre: integer("expected_sale_price_ore"),
    listingPriceOre: integer("listing_price_ore"),
    supplier: text("supplier").notNull().default(""),
    purchaseDate: text("purchase_date").notNull(),
    status: text("status", { enum: ["IN_STOCK", "LISTED", "RESERVED", "SOLD"] }).notNull().default("IN_STOCK"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_tracker_products_status").on(table.status),
    index("idx_tracker_products_name").on(table.name),
    check("tracker_products_quantity_positive", sql`${table.quantity} > 0`),
    check("tracker_products_remaining_valid", sql`${table.remainingQuantity} >= 0 AND ${table.remainingQuantity} <= ${table.quantity}`),
  ],
);

export const trackerTransactions = sqliteTable(
  "tracker_transactions",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => trackerProducts.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["PURCHASE", "SALE"] }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceOre: integer("unit_price_ore").notNull(),
    shippingOre: integer("shipping_ore").notNull().default(0),
    supplier: text("supplier"),
    platform: text("platform"),
    feeOre: integer("fee_ore").notNull().default(0),
    promotedFeeOre: integer("promoted_fee_ore").notNull().default(0),
    otherCostsOre: integer("other_costs_ore").notNull().default(0),
    costBasisOre: integer("cost_basis_ore").notNull().default(0),
    revenueOre: integer("revenue_ore").notNull().default(0),
    totalCostsOre: integer("total_costs_ore").notNull().default(0),
    netProfitOre: integer("net_profit_ore").notNull().default(0),
    occurredAt: text("occurred_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_tracker_transactions_product_id").on(table.productId),
    index("idx_tracker_transactions_type_date").on(table.type, table.occurredAt),
    index("idx_tracker_transactions_date").on(table.occurredAt),
  ],
);

export const trackerImports = sqliteTable(
  "tracker_imports",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    productCount: integer("product_count").notNull(),
    purchaseCount: integer("purchase_count").notNull(),
    saleCount: integer("sale_count").notNull(),
    unitsPurchased: integer("units_purchased").notNull(),
    unitsSold: integer("units_sold").notNull(),
    summaryJson: text("summary_json").notNull(),
    importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("tracker_imports_source_sha256_unique").on(table.sourceSha256)],
);

export const trackerExpenses = sqliteTable(
  "tracker_expenses",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    amountOre: integer("amount_ore").notNull(),
    category: text("category").notNull(),
    occurredAt: text("occurred_at").notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_tracker_expenses_date").on(table.occurredAt),
    index("idx_tracker_expenses_category").on(table.category),
    check("tracker_expenses_amount_positive", sql`${table.amountOre} > 0`),
  ],
);

export const trackerSubscriptions = sqliteTable(
  "tracker_subscriptions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    costOre: integer("cost_ore").notNull(),
    category: text("category").notNull(),
    billingPeriod: text("billing_period", { enum: ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "CUSTOM"] }).notNull(),
    nextPaymentDate: text("next_payment_date").notNull(),
    autoRenew: integer("auto_renew", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["ACTIVE", "ARCHIVED"] }).notNull().default("ACTIVE"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_tracker_subscriptions_status_renewal").on(table.status, table.nextPaymentDate),
    check("tracker_subscriptions_cost_positive", sql`${table.costOre} > 0`),
  ],
);

export const trackerSubscriptionPayments = sqliteTable(
  "tracker_subscription_payments",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id").notNull().references(() => trackerSubscriptions.id, { onDelete: "restrict" }),
    amountOre: integer("amount_ore").notNull(),
    occurredAt: text("occurred_at").notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_tracker_subscription_payments_subscription_date").on(table.subscriptionId, table.occurredAt),
    index("idx_tracker_subscription_payments_date").on(table.occurredAt),
    check("tracker_subscription_payments_amount_positive", sql`${table.amountOre} > 0`),
  ],
);
