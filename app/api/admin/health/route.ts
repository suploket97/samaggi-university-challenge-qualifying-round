import { missingConfig } from "@/lib/server/env";
import { getRedis } from "@/lib/server/redis";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { handle, ok, requireAdmin } from "@/lib/server/http";
import { authMode } from "@/lib/server/auth";
import { ensureDatabaseTables } from "@/lib/server/db-setup";
import { clearBankCache } from "@/lib/server/bank-repo";

export const dynamic = "force-dynamic";

/** Setup checklist shown on the admin dashboard. */
export async function GET() {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const missing = missingConfig();
    const checks: { name: string; ok: boolean; detail?: string }[] = [];

    try {
      await getRedis().set("health:ping", String(Date.now()), { ex: 60 });
      checks.push({ name: "Redis (live rooms)", ok: true });
    } catch (e) {
      checks.push({ name: "Redis (live rooms)", ok: false, detail: (e as Error).message });
    }
    try {
      const mode = await authMode();
      checks.push({ name: "Host password", ok: mode !== "unset", detail: mode === "env" ? "set by ADMIN_PASSWORD in Vercel" : undefined });
    } catch {
      /* reported by the Redis check */
    }
    checks.push(await checkQuestionBank());
    return ok({ missing, checks, all_ok: missing.length === 0 && checks.every((c) => c.ok) });
  });
}

const TABLE_MISSING = /does not exist|Could not find the table|schema cache/i;

async function tablesReady(): Promise<string | null> {
  const db = getSupabaseAdmin();
  const a = await db.from("quiz_packs").select("quiz_pack_id").limit(1);
  if (a.error) return a.error.message;
  const b = await db.from("questions").select("question_id").limit(1);
  if (b.error) return b.error.message;
  // Competition log (added later): existing databases get these tables created automatically.
  const c = await db.from("competitions").select("competition_id").limit(1);
  if (c.error) return c.error.message;
  const d = await db.from("competition_questions").select("competition_id").limit(1);
  if (d.error) return d.error.message;
  const e = await db.from("competition_events").select("event_id").limit(1);
  if (e.error) return e.error.message;
  return null;
}

/** Checks the question-bank tables and creates them if they're missing. */
async function checkQuestionBank(): Promise<{ name: string; ok: boolean; detail?: string }> {
  const name = "Database (question bank and competition log)";
  try {
    let problem = await tablesReady();
    if (problem && TABLE_MISSING.test(problem)) {
      const setup = await ensureDatabaseTables();
      if (!setup.ok) return { name, ok: false, detail: setup.message };
      clearBankCache();
      // Supabase's API reloads its table list a moment after the tables appear.
      for (let i = 0; i < 8 && problem; i++) {
        await new Promise((r) => setTimeout(r, 750));
        problem = await tablesReady();
      }
      if (problem && TABLE_MISSING.test(problem)) {
        return { name, ok: false, detail: "Tables were just created — refresh this page in a few seconds." };
      }
    }
    return problem ? { name, ok: false, detail: problem } : { name, ok: true };
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message };
  }
}
