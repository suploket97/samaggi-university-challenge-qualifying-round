import { getEngine } from "@/lib/server/engine";
import { fail, handle, normCode, ok, readJson, teamFromRequest } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

const MESSAGES: Record<string, string> = {
  NOT_ACCEPTING: "Too late — answers are locked.",
  ALREADY_ANSWERED: "You've already answered this one.",
  INVALID_ANSWER: "That answer isn't valid.",
  FROZEN: "Your answer for this question was voided because you left the quiz screen.",
  UNKNOWN_TEAM: "We don't recognise your team. Please rejoin.",
};

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const code = normCode((await ctx.params).code);
    const teamId = teamFromRequest(req, code);
    if (!teamId) return fail(401, MESSAGES.UNKNOWN_TEAM, "UNKNOWN_TEAM");
    const body = await readJson<{ answer?: unknown }>(req);
    const res = await getEngine().submitAnswer(code, teamId, body.answer as string[]);
    if (!res.ok) {
      // ALREADY_ANSWERED is fine from the player's point of view: they're locked in.
      const status = res.reason === "ALREADY_ANSWERED" ? 200 : res.reason === "UNKNOWN_TEAM" ? 401 : 409;
      return ok({ ok: false, reason: res.reason, message: MESSAGES[res.reason] }, { status });
    }
    return ok(res);
  });
}
