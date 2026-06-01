ALTER TABLE `competitor_products` MODIFY COLUMN `status` varchar(32) DEFAULT 'suggested' NOT NULL;--> statement-breakpoint
DROP PROCEDURE IF EXISTS _pi_migrate_0003;--> statement-breakpoint
CREATE PROCEDURE _pi_migrate_0003()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competitor_products' AND COLUMN_NAME = 'source_icon') THEN
    ALTER TABLE `competitor_products` ADD `source_icon` text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competitor_products' AND COLUMN_NAME = 'country') THEN
    ALTER TABLE `competitor_products` ADD `country` varchar(8);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competitor_products' AND COLUMN_NAME = 'rating') THEN
    ALTER TABLE `competitor_products` ADD `rating` decimal(3,1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competitor_products' AND COLUMN_NAME = 'review_count') THEN
    ALTER TABLE `competitor_products` ADD `review_count` int;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competitor_products' AND COLUMN_NAME = 'shipping_raw') THEN
    ALTER TABLE `competitor_products` ADD `shipping_raw` varchar(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competitor_products' AND COLUMN_NAME = 'shipping_extracted') THEN
    ALTER TABLE `competitor_products` ADD `shipping_extracted` decimal(12,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competitor_products' AND COLUMN_NAME = 'total_raw') THEN
    ALTER TABLE `competitor_products` ADD `total_raw` varchar(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competitor_products' AND COLUMN_NAME = 'total_extracted') THEN
    ALTER TABLE `competitor_products` ADD `total_extracted` decimal(12,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competitor_products' AND COLUMN_NAME = 'raw_old_price') THEN
    ALTER TABLE `competitor_products` ADD `raw_old_price` varchar(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competitor_products' AND COLUMN_NAME = 'extracted_old_price') THEN
    ALTER TABLE `competitor_products` ADD `extracted_old_price` decimal(12,4);
  END IF;
END;--> statement-breakpoint
CALL _pi_migrate_0003();--> statement-breakpoint
DROP PROCEDURE IF EXISTS _pi_migrate_0003;
