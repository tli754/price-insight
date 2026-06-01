CREATE TABLE `customer_addresses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int NOT NULL,
	`shopify_address_id` bigint unsigned,
	`address1` varchar(255),
	`address2` varchar(255),
	`city` varchar(128),
	`province` varchar(128),
	`country` varchar(128),
	`zip` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_addresses_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_addresses_shopify_address_id_unique` UNIQUE(`shopify_address_id`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shopify_customer_id` bigint unsigned NOT NULL,
	`email` varchar(255) NOT NULL,
	`first_name` varchar(255) NOT NULL,
	`last_name` varchar(255) NOT NULL,
	`phone` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_shopify_customer_id_unique` UNIQUE(`shopify_customer_id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`product_id` int,
	`shopify_line_item_id` bigint unsigned NOT NULL,
	`shopify_product_id` bigint unsigned,
	`shopify_variant_id` bigint unsigned,
	`title` varchar(500) NOT NULL,
	`variant_title` varchar(255),
	`sku` varchar(255),
	`quantity` int NOT NULL,
	`unit_price` decimal(12,4),
	`total_discount` decimal(12,4),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_items_shopify_line_item_id_unique` UNIQUE(`shopify_line_item_id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shopify_order_id` bigint unsigned NOT NULL,
	`customer_id` int,
	`order_number` varchar(64) NOT NULL,
	`email` varchar(255),
	`financial_status` varchar(64),
	`fulfillment_status` varchar(64),
	`currency` varchar(16),
	`subtotal_price` decimal(12,4),
	`total_price` decimal(12,4),
	`total_tax` decimal(12,4),
	`total_shipping` decimal(12,4),
	`total_discounts` decimal(12,4),
	`cancelled_at` timestamp,
	`shopify_created_at` timestamp,
	`shopify_updated_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_shopify_order_id_unique` UNIQUE(`shopify_order_id`)
);
--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `customer_addresses_customer_id_idx` ON `customer_addresses` (`customer_id`);--> statement-breakpoint
CREATE INDEX `order_items_order_id_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_product_id_idx` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `orders_customer_id_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `orders_shopify_updated_at_idx` ON `orders` (`shopify_updated_at`);
