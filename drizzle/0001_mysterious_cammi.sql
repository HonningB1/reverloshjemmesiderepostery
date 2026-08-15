CREATE TABLE `review_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`product_deal` text NOT NULL,
	`default_platform` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_links_token_unique` ON `review_links` (`token`);--> statement-breakpoint
CREATE TABLE `social_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`url` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_profiles_platform_unique` ON `social_profiles` (`platform`);--> statement-breakpoint
ALTER TABLE `reviews` ADD `review_link_id` integer;