-- Additive: existing imported feedback is seller feedback from the original sync.
ALTER TABLE `ebay_feedback` ADD `feedback_role` text DEFAULT 'SELLER' NOT NULL;
