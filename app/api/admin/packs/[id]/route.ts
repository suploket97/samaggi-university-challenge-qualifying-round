import { SupabaseBankRepo } from "@/lib/server/bank-repo";
import { getEngine } from "@/lib/server/engine";
import { fail, handle, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const { id } = await ctx.params;
    return ok({ questions: await new SupabaseBankRepo().getPackQuestions(decodeURIComponent(id)) });
  });
}

/**
 * Body: { title?, description?, default_time_limit_sec?, apply_time_to_all?: number }
 * apply_time_to_all sets that time on every question in the pack.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const id = decodeURIComponent((await ctx.params).id);
    const b = await readJson<{ title?: string; description?: string | null; default_time_limit_sec?: number; apply_time_to_all?: number }>(req);
    const repo = new SupabaseBankRepo();
    const okTime = (n: unknown) => Number.isInteger(Number(n)) && Number(n) >= 5 && Number(n) <= 600;
    if (b.apply_time_to_all !== undefined) {
      if (!okTime(b.apply_time_to_all)) return fail(400, "Time must be between 5 and 600 seconds");
      const n = await repo.setAllTimes(id, Number(b.apply_time_to_all));
      return ok({ ok: true, updated: n });
    }
    const patch: { title?: string; description?: string | null; default_time_limit_sec?: number } = {};
    if (b.title !== undefined) {
      const t = String(b.title).trim();
      if (t.length < 2 || t.length > 120) return fail(400, "Pack name must be 2–120 characters");
      patch.title = t;
    }
    if (b.description !== undefined) patch.description = b.description ? String(b.description).slice(0, 1000) : null;
    if (b.default_time_limit_sec !== undefined) {
      if (!okTime(b.default_time_limit_sec)) return fail(400, "Time must be between 5 and 600 seconds");
      patch.default_time_limit_sec = Number(b.default_time_limit_sec);
    }
    await repo.updatePack(id, patch);
    return ok({ ok: true });
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const id = decodeURIComponent((await ctx.params).id);
    // Packs are only ever deleted by hand, and never while a game is using them.
    const inUse = (await getEngine().listRooms()).filter((r) => r.quiz_pack_id === id && r.phase !== "ENDED");
    if (inUse.length) {
      return fail(409, `This pack is loaded in room ${inUse.map((r) => r.room_code).join(", ")}. End that game first, then delete the pack.`, "PACK_IN_USE");
    }
    await new SupabaseBankRepo().deletePack(id);
    return ok({ ok: true });
  });
}
