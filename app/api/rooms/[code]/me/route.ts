import { getEngine } from "@/lib/server/engine";
import { fail, handle, normCode, ok, teamAuth } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

/** Rebuilds a player's screen after a refresh or reconnect. */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const code = normCode((await ctx.params).code);
    const auth = teamAuth(req, code);
    if (!auth) return fail(401, "Unknown team", "UNKNOWN_TEAM");
    const engine = getEngine();
    const status = await engine.teamStatus(code, auth.team_id, auth.device);
    if (status === "MOVED") return fail(401, "Your team was moved to another device", "TEAM_MOVED");
    if (status === "UNKNOWN") return fail(401, "The host removed this team from the game", "UNKNOWN_TEAM");
    return ok(await engine.getPlayerContext(code, auth.team_id));
  });
}
