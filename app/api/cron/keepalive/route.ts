import { getSupabaseAdmin } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/**
 * Runs once a day (vercel.json → crons). Supabase's free plan pauses a project
 * after a week without activity; one tiny read a day keeps the question bank
 * awake, so it's ready on the morning of the event.
 * Reveals nothing: it only reports whether the database answered.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const { error } = await getSupabaseAdmin().from("quiz_packs").select("quiz_pack_id").limit(1);
    return Response.json({ ok: !error }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
