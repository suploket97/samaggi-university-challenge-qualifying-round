import { getEngine } from "@/lib/server/engine";
import { handle, normCode, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

/** Team list and answer count for the stage (polled; no answers included). */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const code = normCode((await ctx.params).code);
    return ok(await getEngine().getPublicStatus(code));
  });
}
