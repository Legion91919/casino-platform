// Canonical JSON: the exact bytes a signature covers.
// Keys sorted by UTF-16 code unit, no whitespace, integers only (money is integer minor units,
// so a float in signed data is a bug, not a value to round). Same idea as RFC 8785, kept to the
// value types our events use so it stays small enough to audit.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) throw new TypeError(`${path}: only safe integers can be signed (got ${value})`);
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v, i) => encode(v, `${path}[${i}]`)).join(",")}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${encode(v, `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`${path}: ${typeof value} cannot be signed`);
  }
}
