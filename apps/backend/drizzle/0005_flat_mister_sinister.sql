CREATE TABLE `product_ai_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`status` varchar(20) NOT NULL,
	`model` varchar(100) NOT NULL,
	`report_types` json NOT NULL,
	`input_hash` varchar(64) NOT NULL,
	`input_snapshot` json,
	`output` json,
	`error_message` text,
	`generated_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `product_ai_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `product_ai_reports` ADD CONSTRAINT `product_ai_reports_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `idx_product_ai_reports_product_created` ON `product_ai_reports` (`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_product_ai_reports_product_status` ON `product_ai_reports` (`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_product_ai_reports_input_hash` ON `product_ai_reports` (`input_hash`);