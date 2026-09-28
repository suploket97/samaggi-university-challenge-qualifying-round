import "server-only";
import { env } from "./env";
import { SETUP_SQL } from "./setup-sql";

/**
 * Creates the question-bank tables automatically, so nobody has to paste
 * setup.sql into the Supabase SQL editor.
 *
 * Supabase's normal API can't create tables, but Vercel's Supabase
 * integration also adds a direct Postgres connection string
 * (POSTGRES_URL_NON_POOLING / POSTGRES_URL), which can. The script is
 * idempotent, so running it again is harmless.
 */
export interface SetupResult {
  ok: boolean;
  reason?: "NO_CONNECTION" | "FAILED";
  message?: string;
}

let lastAttempt = 0;
let lastResult: SetupResult | null = null;

/** Strip sslmode from the URL: newer `pg` treats sslmode=require as full verification, which Supabase's pooler cert fails. */
export function connectionConfig(url: string) {
  let connectionString = url;
  try {
    const u = new URL(url);
    for (const p of ["sslmode", "sslrootcert", "sslcert", "sslkey", "supa", "pgbouncer"]) u.searchParams.delete(p);
    connectionString = u.toString();
  } catch {
    /* leave as-is */
  }
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
  return { connectionString, ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 };
}

export async function ensureDatabaseTables(): Promise<SetupResult> {
  const url = env.postgresUrl;
  if (!url) {
    return {
      ok: false,
      reason: "NO_CONNECTION",
      message: "Tables not found, and no direct database connection (POSTGRES_URL) is available to create them. Run supabase/setup.sql in the Supabase SQL editor.",
    };
  }
  // At most one attempt per 30s per server instance.
  if (lastResult && Date.now() - lastAttempt < 30_000) return lastResult;
  lastAttempt = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require("pg");
  const client = new Client(connectionConfig(url));
  try {
    await client.connect();
    await client.query(SETUP_SQL);
    lastResult = { ok: true };
  } catch (e) {
    lastResult = { ok: false, reason: "FAILED", message: "Couldn't create the tables automatically: " + (e as Error).message };
  } finally {
    await client.end().catch(() => {});
  }
  return lastResult;
}
