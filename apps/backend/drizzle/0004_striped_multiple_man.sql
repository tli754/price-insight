ALTER TABLE `competitor_products` DROP INDEX `competitor_products_listing_unique`;--> statement-breakpoint
ALTER TABLE `competitor_products` ADD CONSTRAINT `competitor_products_listing_unique` UNIQUE(`product_id`,`competitor_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `source_icon`;--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `total_raw`;--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `total_extracted`;--> statement-breakpoint
ALTER TABLE `competitor_products` DROP COLUMN `raw_old_price`;