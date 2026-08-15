-- Additive eBay cache and sync state. Existing Reverlo data is not changed or removed.
ALTER TABLE `reviews` ADD `source` text DEFAULT 'REVERLO' NOT NULL;
--> statement-breakpoint
CREATE TABLE `ebay_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ebay_feedback_id` text NOT NULL,
	`username` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`feedback_type` text NOT NULL,
	`item_id` text,
	`item_title` text,
	`received_at` text NOT NULL,
	`hidden_at` text,
	`source` text DEFAULT 'EBAY' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ebay_feedback_source_id_unique` ON `ebay_feedback` (`ebay_feedback_id`);
--> statement-breakpoint
CREATE TABLE `ebay_sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_sync_at` text,
	`last_success_at` text,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CHECK (`id` = 1)
);
--> statement-breakpoint
INSERT OR IGNORE INTO `ebay_sync_state` (`id`, `imported_count`) VALUES (1, 0);
