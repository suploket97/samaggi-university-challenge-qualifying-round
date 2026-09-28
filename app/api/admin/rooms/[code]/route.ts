import { getEngine } from "@/lib/server/engine";
import { handle, normCode, ok, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    await getEngine().deleteRoom(normCode((await ctx.params).code));
    return ok({ ok: true });
  });
}
