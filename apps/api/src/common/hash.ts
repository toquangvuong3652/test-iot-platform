import * as crypto from "node:crypto";

/** High-entropy device token (hex). Returned once at device registration. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * SHA-256 hex. Used for DEVICE tokens (high-entropy, not user passwords) —
 * cheap to verify per MQTT CONNECT. User passwords use bcrypt (see User module).
 */
export function sha256hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256hexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}
