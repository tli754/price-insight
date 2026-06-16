import { createHmac, timingSafeEqual } from "crypto";

export function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  const computed = createHmac("sha256", secret).update(rawBody).digest("base64");
  const providedBuf = Buffer.from(hmacHeader, "utf8");
  const computedBuf = Buffer.from(computed, "utf8");
  if (providedBuf.length !== computedBuf.length) return false;
  return timingSafeEqual(providedBuf, computedBuf);
}
