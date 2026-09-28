import { SupabaseBankRepo } from "@/lib/server/bank-repo";
import { fail, handle, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    return ok({ packs: await new SupabaseBankRepo().listPacks() });
  });
}

/** Create an empty pack from the editor. */
export async function POST(req: Request) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const b = await readJson<{ title?: string; default_time_limit_sec?: number }>(req);
    const title = String(b.title ?? "").trim();
    if (title.length < 2 || title.length > 120) return fail(400, "Pack name must be 2–120 characters");
    const t = Math.round(Number(b.default_time_limit_sec ?? 30));
    if (!(t >= 5 && t <= 600)) return fail(400, "Time must be between 5 and 600 seconds");
    return ok({ pack: await new SupabaseBankRepo().createPack(title, t) });
  });
}
