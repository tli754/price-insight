ALTER TABLE `competitor_products` MODIFY COLUMN `status` varchar(32) DEFAULT 'suggested' NOT NULL;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD IF NOT EXISTS `source_icon` text;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD IF NOT EXISTS `country` varchar(8);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD IF NOT EXISTS `rating` decimal(3,1);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD IF NOT EXISTS `review_count` int;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD IF NOT EXISTS `shipping_raw` varchar(64);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD IF NOT EXISTS `shipping_extracted` decimal(12,4);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD IF NOT EXISTS `total_raw` varchar(64);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD IF NOT EXISTS `total_extracted` decimal(12,4);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD IF NOT EXISTS `raw_old_price` varchar(64);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD IF NOT EXISTS `extracted_old_price` decimal(12,4);