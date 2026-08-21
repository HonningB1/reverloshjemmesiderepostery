-- Records one-off tracker imports so the same source cannot be applied twice.
-- Existing tracker, review, admin, and eBay data are untouched.
CREATE TABLE `tracker_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_sha256` text NOT NULL,
	`product_count` integer NOT NULL,
	`purchase_count` integer NOT NULL,
	`sale_count` integer NOT NULL,
	`units_purchased` integer NOT NULL,
	`units_sold` integer NOT NULL,
	`summary_json` text NOT NULL,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CHECK (`product_count` >= 0),
	CHECK (`purchase_count` >= 0),
	CHECK (`sale_count` >= 0),
	CHECK (`units_purchased` >= 0),
	CHECK (`units_sold` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracker_imports_source_sha256_unique` ON `tracker_imports` (`source_sha256`);
--> statement-breakpoint
PRAGMA optimize;
