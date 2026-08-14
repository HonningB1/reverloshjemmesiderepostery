CREATE TABLE `review_counters` (
	`name` text PRIMARY KEY NOT NULL,
	`current_value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `review_counters` (`name`, `current_value`) VALUES ('reviews', 0);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`review_id` text NOT NULL,
	`submission_token` text NOT NULL,
	`username` text NOT NULL,
	`rating` integer NOT NULL,
	`review` text NOT NULL,
	`product_deal` text NOT NULL,
	`platform` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_review_id_unique` ON `reviews` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_submission_token_unique` ON `reviews` (`submission_token`);
