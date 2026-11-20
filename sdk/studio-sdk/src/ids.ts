// UUIDv7: time-ordered ids. Cashier refuses transaction ids that are not time-ordered (KEY_EXPIRED
// after 30 days), so wallet transaction ids are minted as UUIDv7 and stored before first use.
import { randomBytes } from "node:crypto";

export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6); // 48-bit Unix milliseconds
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);
