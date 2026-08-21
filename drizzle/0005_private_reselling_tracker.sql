-- Additive, private tracker storage. Existing Reverlo review and eBay tables are untouched.
CREATE TABLE `tracker_products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`quantity` integer NOT NULL,
	`remaining_quantity` integer NOT NULL,
	`purchase_price_ore` integer NOT NULL,
	`purchase_shipping_ore` integer DEFAULT 0 NOT NULL,
	`expected_sale_price_ore` integer,
	`listing_price_ore` integer,
	`supplier` text DEFAULT '' NOT NULL,
	`purchase_date` text NOT NULL,
	`status` text DEFAULT 'IN_STOCK' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CHECK (`quantity` > 0),
	CHECK (`remaining_quantity` >= 0 AND `remaining_quantity` <= `quantity`),
	CHECK (`purchase_price_ore` >= 0),
	CHECK (`purchase_shipping_ore` >= 0),
	CHECK (`expected_sale_price_ore` IS NULL OR `expected_sale_price_ore` >= 0),
	CHECK (`listing_price_ore` IS NULL OR `listing_price_ore` >= 0),
	CHECK (`status` IN ('IN_STOCK', 'LISTED', 'RESERVED', 'SOLD'))
);
--> statement-breakpoint
CREATE TABLE `tracker_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_ore` integer NOT NULL,
	`shipping_ore` integer DEFAULT 0 NOT NULL,
	`supplier` text,
	`platform` text,
	`fee_ore` integer DEFAULT 0 NOT NULL,
	`promoted_fee_ore` integer DEFAULT 0 NOT NULL,
	`other_costs_ore` integer DEFAULT 0 NOT NULL,
	`cost_basis_ore` integer DEFAULT 0 NOT NULL,
	`revenue_ore` integer DEFAULT 0 NOT NULL,
	`total_costs_ore` integer DEFAULT 0 NOT NULL,
	`net_profit_ore` integer DEFAULT 0 NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `tracker_products`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`type` IN ('PURCHASE', 'SALE')),
	CHECK (`quantity` > 0),
	CHECK (`unit_price_ore` >= 0),
	CHECK (`shipping_ore` >= 0),
	CHECK (`fee_ore` >= 0),
	CHECK (`promoted_fee_ore` >= 0),
	CHECK (`other_costs_ore` >= 0),
	CHECK (`cost_basis_ore` >= 0),
	CHECK (`revenue_ore` >= 0),
	CHECK (`total_costs_ore` >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_tracker_products_status` ON `tracker_products` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_tracker_products_name` ON `tracker_products` (`name`);
--> statement-breakpoint
CREATE INDEX `idx_tracker_transactions_product_id` ON `tracker_transactions` (`product_id`);
--> statement-breakpoint
CREATE INDEX `idx_tracker_transactions_type_date` ON `tracker_transactions` (`type`, `occurred_at`);
--> statement-breakpoint
CREATE INDEX `idx_tracker_transactions_date` ON `tracker_transactions` (`occurred_at`);
--> statement-breakpoint
PRAGMA optimize;
