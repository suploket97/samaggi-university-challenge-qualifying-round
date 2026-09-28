"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let clientPromise: Promise<SupabaseClient | null> | null = null;

/**
 * Browser Supabase client, used only for Realtime broadcast. Config comes
 * from /api/config, so it works however the env vars were named.
 */
export function getBrowserSupabase(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((cfg: { supabaseUrl: string | null; supabaseAnonKey: string | null }) => {
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return null;
        return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          realtime: { params: { eventsPerSecond: 20 } },
        });
      })
      .catch(() => null);
  }
  return clientPromise;
}
