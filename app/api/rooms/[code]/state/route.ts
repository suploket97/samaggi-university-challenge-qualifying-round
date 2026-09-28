import { getEngine } from "@/lib/server/engine";
import { toPublicSnapshot } from "@/lib/game/engine";
import { handle, normCode, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const code = normCode((await ctx.params).code);
    const state = await getEngine().getState(code);
    return ok({ snapshot: toPublicSnapshot(state, Date.now()) });
  });
}
