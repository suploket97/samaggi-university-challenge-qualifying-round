import "server-only";
import type { Publisher, RealtimeEvent } from "@/lib/game/engine";
import { env, required } from "./env";

/**
 * Sends a Supabase Realtime broadcast over plain HTTPS, so a serverless
 * function doesn't have to open (and wait for) a websocket.
 * Clients listen with supabase.channel(`room:${code}`).on("broadcast", ...).
 */
export class SupabaseBroadcastPublisher implements Publisher {
  async publish(roomCode: string, event: RealtimeEvent): Promise<void> {
    const url = required(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
    const key = required(env.supabaseServiceKey, "SUPABASE_SERVICE_ROLE_KEY");
    const headers: Record<string, string> = { "Content-Type": "application/json", apikey: key };
    // Legacy keys are JWTs and also go in Authorization; new sb_secret_ keys must not.
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: [{ topic: `room:${roomCode}`, event: event.kind, payload: event, private: false }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Broadcast failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  }
}
