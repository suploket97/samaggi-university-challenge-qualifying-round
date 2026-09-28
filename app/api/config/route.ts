import { env } from "@/lib/server/env";
import { ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Public realtime config for browsers (the anon key is designed to be public). */
export async function GET() {
  return ok({ supabaseUrl: env.supabaseUrl ?? null, supabaseAnonKey: env.supabaseAnonKey ?? null });
}
