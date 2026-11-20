// Test helper: a fresh database with the given migrations applied, on the server PGHOST points at.
// Tests that need Postgres call this; when PGHOST is not set they are skipped (run them through
// tools/with-postgres.sh, scripts/test-all.sh or CI, which all provide a server).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const hasPostgres = () => Boolean(process.env.PGHOST);

export async function freshDatabase(migrationsDir: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const pg = (await import("pg")).default;
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const client = new pg.Client({ database: name });
  await client.connect();
  for (const f of readdirSync(migrationsDir).filter((f) => /^V\d+__.*\.sql$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    await client.query(readFileSync(join(migrationsDir, f), "utf8"));
  }
  await client.end();
  const host = process.env.PGHOST!, port = process.env.PGPORT ?? "5432", user = process.env.PGUSER ?? "postgres";
  const pw = process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : "";
  return {
    url: `postgres://${user}${pw}@${host}:${port}/${name}`,
    drop: async () => {
      const a = new pg.Client({ database: "postgres" });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
