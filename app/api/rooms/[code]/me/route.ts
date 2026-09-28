import { getEngine } from "@/lib/server/engine";
import { fail, handle, normCode, ok, teamFromRequest } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

/** Rebuilds a player's screen after a refresh or reconnect. */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const code = normCode((await ctx.params).code);
    const teamId = teamFromRequest(req, code);
    if (!teamId) return fail(401, "Unknown team", "UNKNOWN_TEAM");
    return ok(await getEngine().getPlayerContext(code, teamId));
  });
}
