ALTER TABLE `customers` ADD `state` varchar(32);--> statement-breakpoint
ALTER TABLE `customers` ADD `currency` varchar(16);--> statement-breakpoint
ALTER TABLE `customers` ADD `verified_email` boolean;--> statement-breakpoint
ALTER TABLE `customers` ADD `customer_tags` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `current_quantity` int;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD `address_name` varchar(255);--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD `company` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `source_name` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `referring_site` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `landing_site` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `processed_at` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD `total_weight` decimal(10,3);--> statement-breakpoint
ALTER TABLE `competitor_products` DROP INDEX `competitor_products_listing_unique`;--> statement-breakpoint
ALTER TABLE `competitor_products` MODIFY COLUMN `competitor_id` int;--> statement-breakpoint
ALTER TABLE `competitor_products` MODIFY COLUMN `external_id` varchar(255);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `status` varchar(32) DEFAULT 'suggested' NOT NULL;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `country` varchar(8);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `rating` decimal(3,1);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `review_count` int;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `shipping_raw` varchar(64);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `shipping_extracted` decimal(12,4);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `extracted_old_price` decimal(12,4);--> statement-breakpoint
ALTER TABLE `competitor_products` ADD CONSTRAINT `competitor_products_listing_unique` UNIQUE(`product_id`,`competitor_id`,`external_id`);