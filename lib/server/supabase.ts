import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, required } from "./env";

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS, so it must never reach the browser. */
export function getSupabaseAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(
      required(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
      required(env.supabaseServiceKey, "SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return admin;
}
