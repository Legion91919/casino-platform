// Detached Ed25519 signatures over canonical JSON. Used for round outcomes: the studio signs,
// Catwalk verifies with the key the studio registered at Dealer, so a round in a player's history
// is exactly what the certified game server decided.
import { sign, verify, type KeyObject } from "node:crypto";
import { canonicalJson } from "./canonical.ts";
import type { SigningKey } from "./keys.ts";

export interface DetachedSignature {
  alg: "Ed25519";
  keyId: string;
  value: string; // base64url
}

export function signCanonical(payload: unknown, key: SigningKey): DetachedSignature {
  const value = sign(null, Buffer.from(canonicalJson(payload), "utf8"), key.privateKey).toString("base64url");
  return { alg: "Ed25519", keyId: key.kid, value };
}

export function verifyCanonical(payload: unknown, signature: DetachedSignature, keys: Map<string, KeyObject>): boolean {
  if (signature?.alg !== "Ed25519" || typeof signature.value !== "string") return false;
  const key = keys.get(signature.keyId);
  if (!key) return false;
  let bytes: string;
  try {
    bytes = canonicalJson(payload);
  } catch {
    return false;
  }
  const sig = Buffer.from(signature.value, "base64url");
  if (sig.length !== 64) return false;
  return verify(null, Buffer.from(bytes, "utf8"), key, sig);
}
