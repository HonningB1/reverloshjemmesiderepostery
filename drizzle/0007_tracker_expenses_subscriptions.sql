-- Additive operating-expense storage for the private tracker.
-- Subscription definitions are forecasts; only payment rows count as actual expenses.
CREATE TABLE `tracker_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`category` text NOT NULL,
	`occurred_at` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CHECK (`amount_ore` > 0)
);
--> statement-breakpoint
CREATE TABLE `tracker_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cost_ore` integer NOT NULL,
	`category` text NOT NULL,
	`billing_period` text NOT NULL,
	`next_payment_date` text NOT NULL,
	`auto_renew` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CHECK (`cost_ore` > 0),
	CHECK (`billing_period` IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM')),
	CHECK (`auto_renew` IN (0, 1)),
	CHECK (`status` IN ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE `tracker_subscription_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `tracker_subscriptions`(`id`) ON UPDATE no action ON DELETE restrict,
	CHECK (`amount_ore` > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_tracker_expenses_date` ON `tracker_expenses` (`occurred_at`);
--> statement-breakpoint
CREATE INDEX `idx_tracker_expenses_category` ON `tracker_expenses` (`category`);
--> statement-breakpoint
CREATE INDEX `idx_tracker_subscriptions_status_renewal` ON `tracker_subscriptions` (`status`, `next_payment_date`);
--> statement-breakpoint
CREATE INDEX `idx_tracker_subscription_payments_subscription_date` ON `tracker_subscription_payments` (`subscription_id`, `occurred_at`);
--> statement-breakpoint
CREATE INDEX `idx_tracker_subscription_payments_date` ON `tracker_subscription_payments` (`occurred_at`);
--> statement-breakpoint
PRAGMA optimize;
