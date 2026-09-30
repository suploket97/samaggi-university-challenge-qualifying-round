import { getEngine } from "@/lib/server/engine";
import { handle, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    return ok({ rooms: await getEngine().listRooms() });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const body = await readJson<{ anti_cheat_policy?: string; max_teams?: number; focus_violation_sec?: number; scoring_mode?: string }>(req);
    const settings: Record<string, unknown> = {};
    if (body.anti_cheat_policy === "FLAG_ONLY" || body.anti_cheat_policy === "VOID_CURRENT_ANSWER") {
      settings.anti_cheat_policy = body.anti_cheat_policy;
    }
    if (Number.isInteger(body.max_teams) && body.max_teams! > 0 && body.max_teams! <= 1000) settings.max_teams = body.max_teams;
    if (Number(body.focus_violation_sec) >= 1 && Number(body.focus_violation_sec) <= 60) {
      settings.focus_violation_ms = Math.round(Number(body.focus_violation_sec) * 1000);
    }
    if (body.scoring_mode === "CLASSIC" || body.scoring_mode === "ACCURACY" || body.scoring_mode === "DECAY") {
      settings.scoring_mode = body.scoring_mode;
    }
    const state = await getEngine().createRoom(settings);
    return ok({ room_code: state.room_code });
  });
}
