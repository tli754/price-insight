CREATE TABLE `competitor` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`state` varchar(32) NOT NULL DEFAULT 'active',
	`thumbnail` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `competitor_id` PRIMARY KEY(`id`),
	CONSTRAINT `competitor_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `competitor_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`competitor_id` int NOT NULL,
	`state` varchar(32) NOT NULL DEFAULT 'active',
	`title` text NOT NULL,
	`external_id` varchar(255),
	`product_link_hash` varchar(64) NOT NULL,
	`product_link` text NOT NULL,
	`source` varchar(255) NOT NULL,
	`price` varchar(64),
	`extracted_price` decimal(12,4) NOT NULL,
	`old_price` varchar(64),
	`extracted_old_price` decimal(12,4),
	`currency` varchar(16),
	`thumbnail` text,
	`tag` text,
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitor_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `competitor_products_product_listing_unique` UNIQUE(`product_id`,`competitor_id`,`product_link_hash`)
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`competitor_product_id` int NOT NULL,
	`price` decimal(12,4) NOT NULL,
	`old_price` decimal(12,4),
	`currency` varchar(16),
	`observed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_insights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`reference_count` int NOT NULL,
	`minimum_price` decimal(12,4) NOT NULL,
	`maximum_price` decimal(12,4) NOT NULL,
	`average_price` decimal(12,4) NOT NULL,
	`median_price` decimal(12,4) NOT NULL,
	`position_label` varchar(32) NOT NULL,
	`percentile` decimal(7,4) NOT NULL,
	`difference_to_average` decimal(12,4) NOT NULL,
	`difference_to_average_percent` decimal(8,4) NOT NULL,
	`recommendation` text NOT NULL,
	`confidence` varchar(16) NOT NULL,
	`analysis_payload` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_insights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`external_id` varchar(225),
	`status` varchar(32) NOT NULL DEFAULT 'pending',
	`source_url_hash` varchar(64) NOT NULL,
	`source_url` varchar(2048) NOT NULL,
	`product_name` varchar(500),
	`brand` varchar(255),
	`model_or_variant` varchar(255),
	`thumbnail` text,
	`price` decimal(12,4),
	`sales_price` decimal(12,4),
	`currency` varchar(16),
	`availability` varchar(128),
	`seller_or_store` varchar(255),
	`product_category` varchar(255),
	`key_specs` json,
	`confidence` varchar(16),
	`raw_reader_content` text,
	`extraction_payload` json,
	`last_extracted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_source_url_hash_unique` UNIQUE(`source_url_hash`)
);
--> statement-breakpoint
ALTER TABLE `competitor_products` ADD CONSTRAINT `competitor_products_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD CONSTRAINT `competitor_products_competitor_id_competitor_id_fk` FOREIGN KEY (`competitor_id`) REFERENCES `competitor`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `price_history` ADD CONSTRAINT `price_history_competitor_product_id_competitor_products_id_fk` FOREIGN KEY (`competitor_product_id`) REFERENCES `competitor_products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `price_insights` ADD CONSTRAINT `price_insights_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `competitor_products_product_id_idx` ON `competitor_products` (`product_id`);--> statement-breakpoint
CREATE INDEX `competitor_products_competitor_id_idx` ON `competitor_products` (`competitor_id`);--> statement-breakpoint
CREATE INDEX `competitor_products_product_state_idx` ON `competitor_products` (`product_id`,`state`);--> statement-breakpoint
CREATE INDEX `price_history_competitor_product_id_idx` ON `price_history` (`competitor_product_id`);--> statement-breakpoint
CREATE INDEX `price_history_observed_at_idx` ON `price_history` (`observed_at`);--> statement-breakpoint
CREATE INDEX `price_insights_product_id_idx` ON `price_insights` (`product_id`);--> statement-breakpoint
CREATE INDEX `price_insights_product_created_at_idx` ON `price_insights` (`product_id`,`created_at`);