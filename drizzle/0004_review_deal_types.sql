-- Additive transaction direction for one-time links and their resulting Reverlo reviews.
-- Existing records intentionally remain NULL because their direction is unknown.
ALTER TABLE `review_links` ADD `deal_type` text;
--> statement-breakpoint
ALTER TABLE `reviews` ADD `deal_type` text;
