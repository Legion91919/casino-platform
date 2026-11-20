import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson, keyRing, newSigningKey, signCanonical, signToken, toJwk, TokenError, unsignedPart,
  verifyCanonical, verifyToken, type TokenClaims,
} from "../src/index.ts";

test("canonical JSON sorts keys at every depth and drops whitespace", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } }), '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}');
});

test("canonical JSON refuses floats, so money can never be signed as a float", () => {
  assert.throws(() => canonicalJson({ amountMinor: 10.5 }), /safe integers/);
  assert.throws(() => canonicalJson({ n: Number.NaN }), /safe integers/);
});

test("a signature verifies, and fails after any change to the signed data", () => {
  const key = newSigningKey("studio-key-1");
  const ring = keyRing({ keys: [toJwk(key)] });
  const payload = { roundId: "r1", win: { amountMinor: 500, currency: "EUR" } };
  const sig = signCanonical(payload, key);
  assert.equal(verifyCanonical(payload, sig, ring), true);
  assert.equal(verifyCanonical({ ...payload, win: { amountMinor: 5000, currency: "EUR" } }, sig, ring), false);
  assert.equal(verifyCanonical(payload, { ...sig, keyId: "someone-else" }, ring), false);
});

test("key order does not change the signature (canonical form)", () => {
  const key = newSigningKey("k");
  const ring = keyRing({ keys: [toJwk(key)] });
  const sig = signCanonical({ a: 1, b: 2 }, key);
  assert.equal(verifyCanonical({ b: 2, a: 1 }, sig, ring), true);
});

test("unsignedPart removes only the signature", () => {
  assert.deepEqual(unsignedPart({ a: 1, signature: { x: 1 } }), { a: 1 });
});

const claims = (over: Partial<TokenClaims> = {}): TokenClaims => ({
  iss: "dealer", aud: "catwalk", sub: "8a4b2f5e-3c1d-4e6f-9a7b-1c2d3e4f5a6b", iat: 1_000, exp: 1_120, jti: "j1", ...over,
});

test("tokens verify with the right key, issuer, audience and time", () => {
  const key = newSigningKey("dealer-1");
  const ring = keyRing({ keys: [toJwk(key)] });
  const t = signToken(claims(), key);
  assert.equal(verifyToken(t, ring, { issuer: "dealer", audience: "catwalk", nowSeconds: 1_050 }).sub, claims().sub);
  assert.throws(() => verifyToken(t, ring, { issuer: "dealer", audience: "game", nowSeconds: 1_050 }), /audience/);
  assert.throws(() => verifyToken(t, ring, { issuer: "dealer", audience: "catwalk", nowSeconds: 2_000 }), /expired/);
});

test("tokens with alg none or HS256 are rejected before any key lookup", () => {
  const ring = keyRing({ keys: [] });
  const forge = (alg: string) =>
    `${Buffer.from(JSON.stringify({ alg, kid: "dealer-1" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims())).toString("base64url")}.`;
  for (const alg of ["none", "HS256"]) {
    assert.throws(() => verifyToken(forge(alg), ring, { issuer: "dealer", audience: "catwalk", nowSeconds: 1_050 }), TokenError);
  }
});

test("a token signed by an unregistered key is rejected", () => {
  const trusted = newSigningKey("dealer-1");
  const attacker = newSigningKey("dealer-1"); // same kid, different key
  const ring = keyRing({ keys: [toJwk(trusted)] });
  assert.throws(() => verifyToken(signToken(claims(), attacker), ring, { issuer: "dealer", audience: "catwalk", nowSeconds: 1_050 }), /bad signature/);
});

import { isUuid, uuidv7 } from "../src/index.ts";
test("uuidv7 ids are valid UUIDs and sort by creation time", () => {
  const a = uuidv7(1_700_000_000_000), b = uuidv7(1_700_000_000_001);
  assert.ok(isUuid(a) && isUuid(b));
  assert.equal(a[14], "7");
  assert.ok(a < b);
});
