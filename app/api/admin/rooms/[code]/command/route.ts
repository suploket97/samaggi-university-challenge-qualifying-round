import { getEngine } from "@/lib/server/engine";
import type { AdminCommand } from "@/lib/game/types";
import { fail, handle, normCode, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

function parseCommand(b: Record<string, unknown>): AdminCommand | null {
  switch (b.type) {
    case "SELECT_PACK":
      return typeof b.quiz_pack_id === "string" && b.quiz_pack_id ? { type: "SELECT_PACK", quiz_pack_id: b.quiz_pack_id } : null;
    case "SHOW_QUALIFICATION": {
      const n = Number(b.qualify_count);
      return Number.isInteger(n) && n > 0 ? { type: "SHOW_QUALIFICATION", qualify_count: n } : null;
    }
    case "START_QUESTION": {
      if (b.time_limit_sec === undefined || b.time_limit_sec === null || b.time_limit_sec === "") return { type: "START_QUESTION" };
      const t = Number(b.time_limit_sec);
      return Number.isFinite(t) ? { type: "START_QUESTION", time_limit_sec: t } : null;
    }
    case "ADJUST_TIME": {
      const d = Number(b.delta_sec);
      return Number.isFinite(d) && d !== 0 ? { type: "ADJUST_TIME", delta_sec: d } : null;
    }
    case "MEDIA":
      return b.action === "PLAY" || b.action === "PAUSE" || b.action === "RESTART" ? { type: "MEDIA", action: b.action } : null;
    case "END_QUESTION":
    case "REVEAL_ANSWER":
    case "SHOW_LEADERBOARD":
    case "TERMINATE":
      return { type: b.type };
    default:
      return null;
  }
}

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const code = normCode((await ctx.params).code);
    const cmd = parseCommand(await readJson(req));
    if (!cmd) return fail(400, "Unknown or incomplete command");
    const state = await getEngine().dispatch(code, cmd);
    return ok({ phase: state.phase, version: state.version });
  });
}
