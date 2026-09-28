import { getEngine } from "@/lib/server/engine";
import { fail, handle, normCode, ok, readJson, teamFromRequest } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const code = normCode((await ctx.params).code);
    const teamId = teamFromRequest(req, code);
    if (!teamId) return fail(401, "Unknown team", "UNKNOWN_TEAM");
    const body = await readJson<{ duration_ms?: number; kind?: string }>(req);
    const kind = body.kind === "PASTE_ATTEMPT" ? "PASTE_ATTEMPT" : "FOCUS_LOST";
    return ok(await getEngine().reportFocusLoss(code, teamId, Number(body.duration_ms ?? 0), kind));
  });
}
