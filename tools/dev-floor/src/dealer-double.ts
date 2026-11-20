// Contract double of Dealer (services/dealer/api/openapi.yaml), in memory. Implements only what the
// slot and Catwalk need: launches with single-use tokens, redemption for a signed game-session
// token, JWKS, player history tokens, studio round-signing keys and build lookup.
import { randomBytes } from "node:crypto";
import { keyRing, newSigningKey, publicKeyFromJwk, signToken, toJwk, type Ed25519Jwk, type SigningKey } from "@casino-platform/studio-sdk";
import { HttpError } from "@casino-platform/studio-sdk/http";

export interface BuildInfo { gameCode: string; studioCode: string; version: string; assetBaseUrl: string; replayEntrypoint: string; rtpBps: number; mathModelSha256: string }
interface Launch { playerId: string; operatorCode: string; jurisdictionCode: string; currency: string; gameCode: string; build: BuildInfo; expires: number; used: boolean; sid: string }

export class DealerDouble {
  readonly key: SigningKey = newSigningKey(`dealer-dev-${Date.now()}`);
  private launches = new Map<string, Launch>();
  private studioKeys = new Map<string, Map<string, Ed25519Jwk>>();
  readonly builds = new Map<string, BuildInfo>(); // `${game}@${version}`
  readonly live = new Map<string, string>(); // game -> live version
  readonly killed = new Set<string>();
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  publish(b: BuildInfo) {
    this.builds.set(`${b.gameCode}@${b.version}`, b);
    this.live.set(b.gameCode, b.version);
  }

  jwks() { return { keys: [toJwk(this.key)] }; }
  ring() { return keyRing(this.jwks()); }

  launch(req: { playerId: string; operatorCode: string; gameCode: string; jurisdictionCode: string; currency: string; returnUrl?: string }) {
    if (this.killed.has(req.gameCode)) throw new HttpError(403, "GAME_KILLED", "this game is switched off");
    const version = this.live.get(req.gameCode);
    if (!version) throw new HttpError(403, "NOT_IN_ROLLOUT", "no build of this game is live for the operator");
    const build = this.builds.get(`${req.gameCode}@${version}`)!;
    const token = randomBytes(32).toString("base64url");
    const expires = this.now() + 5 * 60_000;
    this.launches.set(token, { ...req, build, expires, used: false, sid: `ls_${randomBytes(9).toString("base64url")}` });
    const fragment = new URLSearchParams({ token });
    if (req.returnUrl) fragment.set("lobby", new URL(req.returnUrl).origin);
    return { launchUrl: `${build.assetBaseUrl}index.html#${fragment}`, expiresAt: new Date(expires).toISOString(), buildVersion: version };
  }

  redeem(launchToken: string) {
    const l = this.launches.get(launchToken);
    if (!l || l.used || l.expires < this.now()) throw new HttpError(410, "LAUNCH_GONE", "launch token unknown, used or expired");
    l.used = true;
    const iat = Math.floor(this.now() / 1000), exp = iat + 12 * 3600;
    const gameSessionToken = signToken({
      iss: "dealer", aud: `game:${l.gameCode}`, sub: l.playerId, iat, exp, jti: l.sid,
      op: l.operatorCode, jur: l.jurisdictionCode, cur: l.currency, game: l.gameCode, build: l.build.version, sid: l.sid,
    }, this.key);
    return { gameSessionToken, expiresAt: new Date(exp * 1000).toISOString() };
  }

  historyToken(req: { playerId: string; operatorCode: string }) {
    const iat = Math.floor(this.now() / 1000), exp = iat + 3600;
    const token = signToken({ iss: "dealer", aud: "catwalk", sub: req.playerId, op: req.operatorCode, scope: "rounds:read", iat, exp, jti: randomBytes(9).toString("base64url") }, this.key);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  registerStudioKey(studio: string, kid: string, jwk: unknown) {
    const parsed = jwk as Ed25519Jwk;
    publicKeyFromJwk(parsed); // throws if not an Ed25519 public key
    if (parsed.kid !== kid) throw new HttpError(400, "KID_MISMATCH", "kid in path and body differ");
    if (!this.studioKeys.has(studio)) this.studioKeys.set(studio, new Map());
    this.studioKeys.get(studio)!.set(kid, parsed);
  }
  studioJwks(studio: string) { return { keys: [...(this.studioKeys.get(studio)?.values() ?? [])] }; }

  build(gameCode: string, version: string) {
    const b = this.builds.get(`${gameCode}@${version}`);
    if (!b) throw new HttpError(404, "NO_SUCH_BUILD", "unknown build");
    return b;
  }
}
