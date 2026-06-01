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
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`external_id` bigint unsigned NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'draft',
	`thumbnail` text,
	`price` decimal(12,4),
	`currency` varchar(16),
	`handle` varchar(500),
	`title` varchar(500),
	`brand` varchar(255),
	`inventory_quantity` int,
	`weight_unit` varchar(16),
	`weight` decimal(10,3),
	`sku` varchar(255),
	`tags` text,
	`description` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `competitor_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`competitor_id` int NOT NULL,
	`title` text NOT NULL,
	`external_id` varchar(255),
	`product_link` text NOT NULL,
	`source` varchar(255) NOT NULL,
	`currency` varchar(16),
	`thumbnail` text,
	`tag` text,
	`google_position` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `competitor_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `competitor_products_listing_unique` UNIQUE(`product_id`,`competitor_id`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`competitor_product_id` int NOT NULL,
	`price` varchar(64),
	`extracted_price` decimal(12,4) NOT NULL,
	`captured_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_insights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`min_price` decimal(12,4) NOT NULL,
	`max_price` decimal(12,4) NOT NULL,
	`summary` text NOT NULL,
	`market_position` varchar(32) NOT NULL,
	`captured_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_insights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD CONSTRAINT `competitor_products_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD CONSTRAINT `competitor_products_competitor_id_competitor_id_fk` FOREIGN KEY (`competitor_id`) REFERENCES `competitor`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `price_history` ADD CONSTRAINT `price_history_competitor_product_id_competitor_products_id_fk` FOREIGN KEY (`competitor_product_id`) REFERENCES `competitor_products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `price_insights` ADD CONSTRAINT `price_insights_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `products_external_id_idx` ON `products` (`external_id`);--> statement-breakpoint
CREATE INDEX `competitor_products_product_id_idx` ON `competitor_products` (`product_id`);--> statement-breakpoint
CREATE INDEX `competitor_products_competitor_id_idx` ON `competitor_products` (`competitor_id`);--> statement-breakpoint
CREATE INDEX `price_history_competitor_product_id_idx` ON `price_history` (`competitor_product_id`);--> statement-breakpoint
CREATE INDEX `price_insights_product_id_idx` ON `price_insights` (`product_id`);
