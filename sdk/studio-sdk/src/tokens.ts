// Compact JWS tokens signed with EdDSA (Ed25519). Dealer issues them; game servers and Catwalk verify.
// Only EdDSA is accepted: a token claiming "none" or an HMAC algorithm is rejected before any crypto runs.
import { sign, verify, type KeyObject } from "node:crypto";
import type { SigningKey } from "./keys.ts";

export interface TokenClaims {
  iss: string;
  aud: string;
  sub: string; // pseudonymous playerId
  exp: number; // seconds since epoch
  iat: number;
  jti: string;
  [claim: string]: unknown;
}

export class TokenError extends Error {}

const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function signToken(claims: TokenClaims, key: SigningKey): string {
  const header = b64u(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: key.kid }));
  const body = b64u(JSON.stringify(claims));
  const sig = sign(null, Buffer.from(`${header}.${body}`), key.privateKey).toString("base64url");
  return `${header}.${body}.${sig}`;
}

export interface VerifyOptions {
  audience: string | RegExp; // a RegExp lets a service accept a family, e.g. every game:<code> audience
  issuer: string;
  nowSeconds?: number;
  clockSkewSeconds?: number;
}

export function verifyToken(token: string, keys: Map<string, KeyObject>, opts: VerifyOptions): TokenClaims {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) throw new TokenError("malformed token");
  const [h, b, s] = parts as [string, string, string];
  let header: { alg?: unknown; kid?: unknown };
  let claims: TokenClaims;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
  } catch {
    throw new TokenError("malformed token");
  }
  if (header.alg !== "EdDSA") throw new TokenError(`algorithm ${String(header.alg)} is not accepted`);
  const key = typeof header.kid === "string" ? keys.get(header.kid) : undefined;
  if (!key) throw new TokenError("unknown signing key");
  const sig = Buffer.from(s, "base64url");
  if (sig.length !== 64 || !verify(null, Buffer.from(`${h}.${b}`), key, sig)) throw new TokenError("bad signature");
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = opts.clockSkewSeconds ?? 30;
  if (claims.iss !== opts.issuer) throw new TokenError("wrong issuer");
  const audOk = typeof opts.audience === "string" ? claims.aud === opts.audience : typeof claims.aud === "string" && opts.audience.test(claims.aud);
  if (!audOk) throw new TokenError("wrong audience");
  if (typeof claims.exp !== "number" || claims.exp + skew < now) throw new TokenError("token expired");
  if (typeof claims.iat !== "number" || claims.iat - skew > now) throw new TokenError("token issued in the future");
  if (typeof claims.sub !== "string" || claims.sub.length === 0) throw new TokenError("token has no subject");
  return claims;
}
