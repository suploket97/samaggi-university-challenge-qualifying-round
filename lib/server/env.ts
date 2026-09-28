import "server-only";

/**
 * Environment variables. Several names are accepted for each value so the
 * app works with the Vercel Marketplace integrations (which inject their own
 * names) or with values you paste in yourself.
 */
function clean(v: string | undefined): string | undefined {
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Finds a variable by exact name, or by name with a prefix. Vercel's Storage
 * integrations add a prefix when you give one (e.g. STORAGE_KV_REST_API_URL).
 * Returns the value and the prefix used, so paired values come from the same connection.
 */
function find(names: string[], preferPrefix?: string): { value: string; prefix: string } | undefined {
  if (preferPrefix !== undefined) {
    for (const n of names) {
      const v = clean(process.env[preferPrefix + n]);
      if (v) return { value: v, prefix: preferPrefix };
    }
  }
  for (const n of names) {
    const v = clean(process.env[n]);
    if (v) return { value: v, prefix: "" };
  }
  // Names are in order of preference, so check each name across all variables before the next.
  const entries = Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b));
  for (const n of names) {
    for (const [k, raw] of entries) {
      const v = clean(raw);
      if (v && k.endsWith("_" + n)) return { value: v, prefix: k.slice(0, k.length - n.length) };
    }
  }
  return undefined;
}

const REST_URL = ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"];
const REST_TOKEN = ["UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"];
const TCP_URL = ["REDIS_URL", "KV_URL", "UPSTASH_REDIS_URL"];

export const env = {
  get redisUrl() {
    return find(REST_URL)?.value;
  },
  get redisToken() {
    const url = find(REST_URL);
    return find(REST_TOKEN, url?.prefix)?.value;
  },
  /** redis:// or rediss:// connection string (Vercel's "Redis" integration, or Upstash's KV_URL). */
  get redisTcpUrl() {
    return find(TCP_URL)?.value;
  },
  get supabaseUrl() {
    return find(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"])?.value;
  },
  get supabaseAnonKey() {
    return find(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"])?.value;
  },
  get supabaseServiceKey() {
    return find(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"])?.value;
  },
  /** Direct Postgres connection (added by Vercel's Supabase integration). Used only to create tables. */
  get postgresUrl() {
    return find(["POSTGRES_URL_NON_POOLING", "POSTGRES_URL", "SUPABASE_DB_URL", "DATABASE_URL"])?.value;
  },
  get adminPassword() {
    return clean(process.env.ADMIN_PASSWORD);
  },
  get sessionSecret() {
    return clean(process.env.SESSION_SECRET);
  },
};

/** Names (never values) of variables that look database-related, to help diagnose setup problems. */
export function relatedEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((k) => /REDIS|KV_|UPSTASH|SUPABASE|POSTGRES|DATABASE_URL/i.test(k))
    .sort();
}

export const REDIS_HELP =
  "The live-game database (Redis) isn't connected to this Vercel project. In Vercel, open this project → Storage → " +
  "connect “Upstash for Redis” (or create one and connect it), then go to Deployments → ⋯ → Redeploy";

export class ConfigError extends Error {}

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!(env.redisUrl && env.redisToken) && !env.redisTcpUrl) missing.push("Redis for live games: connect “Upstash for Redis” on the project's Storage tab, then redeploy");
  if (!env.supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.supabaseAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!env.supabaseServiceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

export const SUPABASE_HELP =
  "The question database (Supabase) isn't connected to this Vercel project. In Vercel, open this project → Storage → " +
  "connect your Supabase database (or create one and connect it), then go to Deployments → ⋯ → Redeploy";

export function required(value: string | undefined, name: string): string {
  if (!value) throw new ConfigError(/SUPABASE/.test(name) ? SUPABASE_HELP : `Missing setting: ${name}. Add it in Vercel → Settings → Environment Variables, then redeploy`);
  return value;
}
