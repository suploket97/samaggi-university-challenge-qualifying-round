import { competitionVersion, deleteCompetition, getCompetition } from "@/lib/server/competitions";
import { fail, handle, ok, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** ?v=<updated_at> returns { unchanged: true } when nothing new has been recorded. */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const id = decodeURIComponent((await ctx.params).id);
    const known = new URL(req.url).searchParams.get("v");
    if (known) {
      const v = await competitionVersion(id);
      if (v === null) return fail(404, "Competition not found", "NOT_FOUND");
      if (v === known) return ok({ unchanged: true });
    }
    const detail = await getCompetition(id);
    return detail ? ok(detail) : fail(404, "Competition not found", "NOT_FOUND");
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    await deleteCompetition(decodeURIComponent((await ctx.params).id));
    return ok({ ok: true });
  });
}
