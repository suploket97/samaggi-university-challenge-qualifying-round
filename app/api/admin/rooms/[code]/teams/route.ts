import { getEngine } from "@/lib/server/engine";
import { fail, handle, normCode, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

/**
 * Host team management. Body: { team_id, action: "rename", name } |
 * { team_id, action: "remove" } | { team_id, action: "move" } (issues a
 * one-time code for moving the team to a new device). Every action is logged.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const code = normCode((await ctx.params).code);
    const b = await readJson<{ team_id?: unknown; action?: unknown; name?: unknown }>(req);
    const teamId = typeof b.team_id === "string" ? b.team_id : "";
    if (!teamId) return fail(400, "Send team_id");
    const engine = getEngine();
    switch (b.action) {
      case "rename":
        return ok({ team: await engine.renameTeam(code, teamId, String(b.name ?? "")) });
      case "remove":
        await engine.removeTeam(code, teamId);
        return ok({ removed: true });
      case "move":
        return ok(await engine.startTransfer(code, teamId));
      default:
        return fail(400, "action must be rename, remove or move");
    }
  });
}
