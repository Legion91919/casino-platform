// Small HTTP helpers on node:http shared by the sample game server, Catwalk and the dev floor:
// bounded JSON bodies, RFC 9457 problem responses, safe static files and baseline security headers.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { timingSafeEqual, createHash } from "node:crypto";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function readJson(req: IncomingMessage, limitBytes = 16_384): Promise<any> {
  const type = req.headers["content-type"] ?? "";
  if (!type.startsWith("application/json")) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "send application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) throw new HttpError(413, "BODY_TOO_LARGE", `body over ${limitBytes} bytes`);
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "BAD_JSON", "body is not valid JSON");
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

export function sendProblem(res: ServerResponse, status: number, code: string, detail: string) {
  res.writeHead(status, { "content-type": "application/problem+json", "cache-control": "no-store" });
  res.end(JSON.stringify({ type: `https://errors.example.test/${code.toLowerCase()}`, title: code, status, code, detail }));
}

export function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/** Constant-time comparison for shared secrets (dev stand-ins for mTLS). */
export function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest(), hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length > 0;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon",
};

/** Serves a file from `root` only; any path that escapes it (.., encoded or not) is a 404. */
export async function serveStatic(res: ServerResponse, root: string, urlPath: string, headers: Record<string, string> = {}): Promise<boolean> {
  let rel: string;
  try { rel = decodeURIComponent(urlPath.split("?")[0]!); } catch { return false; }
  if (rel.endsWith("/")) rel += "index.html";
  const base = resolve(root);
  const file = resolve(join(base, normalize(rel)));
  if (file !== base && !file.startsWith(base + sep)) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
  } catch {
    return false;
  }
  const body = await readFile(file);
  const ext = extname(file);
  res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": ext === ".html" ? "no-cache" : "public, max-age=300", ...headers });
  res.end(body);
  return true;
}

export function securityHeaders(csp: string): Record<string, string> {
  return {
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
}
