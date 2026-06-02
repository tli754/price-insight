ALTER TABLE `competitor_products` ADD `status` varchar(32) DEFAULT 'suggested' NOT NULL;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `country` varchar(8);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `rating` decimal(3,1);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `review_count` int;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `shipping_raw` varchar(64);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `shipping_extracted` decimal(12,4);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `extracted_old_price` decimal(12,4);--> statement-breakpoint
ALTER TABLE `competitor_products` MODIFY COLUMN `competitor_id` int;
