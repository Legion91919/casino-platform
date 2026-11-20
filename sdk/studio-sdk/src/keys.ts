// Ed25519 keys and JWKs. Studios sign round outcomes; Dealer signs launch and history tokens.
import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";

export interface Ed25519Jwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  use: "sig";
  alg: "EdDSA";
}

export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function newSigningKey(kid: string): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { kid, privateKey, publicKey };
}

/** Load a key from a PKCS#8 PEM (for example from a secret store); the public half is derived. */
export function signingKeyFromPem(kid: string, pkcs8Pem: string): SigningKey {
  const privateKey = createPrivateKey(pkcs8Pem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("signing key must be Ed25519");
  return { kid, privateKey, publicKey: createPublicKey(privateKey) };
}

export function toJwk(key: Pick<SigningKey, "kid" | "publicKey">): Ed25519Jwk {
  const jwk = key.publicKey.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") throw new Error("not an Ed25519 public key");
  return { kty: "OKP", crv: "Ed25519", x: jwk.x, kid: key.kid, use: "sig", alg: "EdDSA" };
}

export function publicKeyFromJwk(jwk: unknown): KeyObject {
  const j = jwk as Partial<Ed25519Jwk> | null;
  if (!j || j.kty !== "OKP" || j.crv !== "Ed25519" || typeof j.x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(j.x)) {
    throw new Error("JWK is not an Ed25519 public key");
  }
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: j.x }, format: "jwk" });
}

/** kid -> public key, built from a JWKS document. Unknown or malformed entries are skipped. */
export function keyRing(jwks: { keys?: unknown[] }): Map<string, KeyObject> {
  const ring = new Map<string, KeyObject>();
  for (const k of jwks.keys ?? []) {
    try {
      const kid = (k as { kid?: unknown }).kid;
      if (typeof kid === "string" && kid.length > 0) ring.set(kid, publicKeyFromJwk(k));
    } catch {
      /* skip keys we cannot use */
    }
  }
  return ring;
}
