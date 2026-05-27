CREATE TABLE `product_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`external_id` bigint unsigned NOT NULL,
	`position` int NOT NULL,
	`alt` varchar(512) NOT NULL,
	`width` int,
	`height` int,
	`src` text NOT NULL,
	CONSTRAINT `product_images_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_images_product_external_unique` UNIQUE(`product_id`,`external_id`)
);
--> statement-breakpoint
ALTER TABLE `competitor_products` DROP INDEX `competitor_products_product_listing_unique`;--> statement-breakpoint
ALTER TABLE `products` DROP INDEX `products_source_url_hash_unique`;--> statement-breakpoint
DROP INDEX `competitor_products_product_state_idx` ON `competitor_products`;--> statement-breakpoint
DROP INDEX `price_history_observed_at_idx` ON `price_history`;--> statement-breakpoint
DROP INDEX `price_insights_product_created_at_idx` ON `price_insights`;--> statement-breakpoint
ALTER TABLE `competitor_products` MODIFY COLUMN `external_id` text;--> statement-breakpoint
ALTER TABLE `price_history` MODIFY COLUMN `price` varchar(64);--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `external_id` bigint unsigned NOT NULL;--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `status` varchar(32) NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `competitor_products` ADD `google_position` int;--> statement-breakpoint
ALTER TABLE `price_history` ADD `extracted_price` decimal(12,4) NOT NULL;--> statement-breakpoint
ALTER TABLE `price_history` ADD `captured_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `price_insights` ADD `min_price` decimal(12,4) NOT NULL;--> statement-breakpoint
ALTER TABLE `price_insights` ADD `max_price` decimal(12,4) NOT NULL;--> statement-breakpoint
ALTER TABLE `price_insights` ADD `summary` text NOT NULL;--> statement-breakpoint
ALTER TABLE `price_insights` ADD `market_position` varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE `price_insights` ADD `captured_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `handle` varchar(500);--> statement-breakpoint
ALTER TABLE `products` ADD `title` varchar(500);--> statement-breakpoint
ALTER TABLE `products` ADD `inventory_quantity` int;--> statement-breakpoint
ALTER TABLE `products` ADD `weight_unit` varchar(16);--> statement-breakpoint
ALTER TABLE `products` ADD `weight` decimal(10,3);--> statement-breakpoint
ALTER TABLE `products` ADD `sku` varchar(255);--> statement-breakpoint
ALTER TABLE `products` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `products` ADD `description` text;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD CONSTRAINT `competitor_products_listing_unique` UNIQUE(`product_id`,`competitor_id`,`product_link`);--> statement-breakpoint
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `products_external_id_idx` ON `products` (`external_id`);--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `state`;--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `product_link_hash`;--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `price`;--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `extracted_price`;--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `old_price`;--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `extracted_old_price`;--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `last_seen_at`;--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `updated_at`;--> statement-breakpoint
ALTER TABLE `price_history` DROP COLUMN `old_price`;--> statement-breakpoint
ALTER TABLE `price_history` DROP COLUMN `currency`;--> statement-breakpoint
ALTER TABLE `price_history` DROP COLUMN `observed_at`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `reference_count`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `minimum_price`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `maximum_price`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `average_price`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `median_price`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `position_label`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `percentile`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `difference_to_average`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `difference_to_average_percent`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `recommendation`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `confidence`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `analysis_payload`;--> statement-breakpoint
ALTER TABLE `price_insights` DROP COLUMN `created_at`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `source_url_hash`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `source_url`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `product_name`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `model_or_variant`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `sales_price`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `availability`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `seller_or_store`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `product_category`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `key_specs`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `confidence`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `raw_reader_content`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `extraction_payload`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `last_extracted_at`;