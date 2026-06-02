ALTER TABLE `customer_addresses` ADD `address_name` varchar(255);--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD `company` varchar(255);--> statement-breakpoint
ALTER TABLE `customers` ADD `state` varchar(32);--> statement-breakpoint
ALTER TABLE `customers` ADD `currency` varchar(16);--> statement-breakpoint
ALTER TABLE `customers` ADD `verified_email` boolean;--> statement-breakpoint
ALTER TABLE `customers` ADD `customer_tags` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `current_quantity` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `source_name` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `referring_site` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `landing_site` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `processed_at` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD `total_weight` decimal(10,3);