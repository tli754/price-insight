import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const conn = await mysql.createConnection(url);

await conn.query("SET FOREIGN_KEY_CHECKS = 0");

// Drop all old tables
for (const table of [
  "price_insights",
  "price_history",
  "competitor_products",
  "competitor",
  "product_images",
  "products"
]) {
  await conn.query(`DROP TABLE IF EXISTS \`${table}\``);
  console.log(`dropped ${table}`);
}

// products
await conn.query(`
  CREATE TABLE products (
    id              INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
    external_id     BIGINT UNSIGNED NOT NULL,
    status          VARCHAR(32)   NOT NULL DEFAULT 'draft',
    thumbnail       TEXT,
    price           DECIMAL(12,4),
    currency        VARCHAR(16),
    handle          VARCHAR(500),
    title           VARCHAR(500),
    brand           VARCHAR(255),
    inventory_quantity INT,
    weight_unit     VARCHAR(16),
    weight          DECIMAL(10,3),
    sku             VARCHAR(255),
    tags            TEXT,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX products_external_id_idx (external_id)
  )
`);
console.log("created products");

// product_images
await conn.query(`
  CREATE TABLE product_images (
    id          INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
    product_id  INT           NOT NULL,
    external_id BIGINT UNSIGNED NOT NULL,
    position    INT           NOT NULL,
    alt         VARCHAR(512)  NOT NULL,
    width       INT,
    height      INT,
    src         TEXT          NOT NULL,
    UNIQUE INDEX product_images_product_external_unique (product_id, external_id),
    CONSTRAINT fk_product_images_product FOREIGN KEY (product_id)
      REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE
  )
`);
console.log("created product_images");

// competitor
await conn.query(`
  CREATE TABLE competitor (
    id          INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255)  NOT NULL,
    state       VARCHAR(32)   NOT NULL DEFAULT 'active',
    thumbnail   TEXT,
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX competitor_name_unique (name)
  )
`);
console.log("created competitor");

// competitor_products
await conn.query(`
  CREATE TABLE competitor_products (
    id              INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
    product_id      INT           NOT NULL,
    competitor_id   INT           NOT NULL,
    title           TEXT          NOT NULL,
    external_id     TEXT,
    product_link    TEXT          NOT NULL,
    source          VARCHAR(255)  NOT NULL,
    currency        VARCHAR(16),
    thumbnail       TEXT,
    tag             TEXT,
    google_position INT,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX competitor_products_product_id_idx (product_id),
    INDEX competitor_products_competitor_id_idx (competitor_id),
    UNIQUE INDEX competitor_products_listing_unique (product_id, competitor_id, product_link(512)),
    CONSTRAINT fk_cp_product FOREIGN KEY (product_id)
      REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_cp_competitor FOREIGN KEY (competitor_id)
      REFERENCES competitor (id) ON DELETE RESTRICT ON UPDATE CASCADE
  )
`);
console.log("created competitor_products");

// price_history
await conn.query(`
  CREATE TABLE price_history (
    id                    INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
    competitor_product_id INT           NOT NULL,
    price                 VARCHAR(64),
    extracted_price       DECIMAL(12,4) NOT NULL,
    captured_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX price_history_competitor_product_id_idx (competitor_product_id),
    CONSTRAINT fk_ph_competitor_product FOREIGN KEY (competitor_product_id)
      REFERENCES competitor_products (id) ON DELETE CASCADE ON UPDATE CASCADE
  )
`);
console.log("created price_history");

// price_insights
await conn.query(`
  CREATE TABLE price_insights (
    id              INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
    product_id      INT           NOT NULL,
    min_price       DECIMAL(12,4) NOT NULL,
    max_price       DECIMAL(12,4) NOT NULL,
    summary         TEXT          NOT NULL,
    market_position VARCHAR(32)   NOT NULL,
    captured_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX price_insights_product_id_idx (product_id),
    CONSTRAINT fk_pi_product FOREIGN KEY (product_id)
      REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE
  )
`);
console.log("created price_insights");

await conn.query("SET FOREIGN_KEY_CHECKS = 1");
await conn.end();

console.log("\nMigration complete.");
