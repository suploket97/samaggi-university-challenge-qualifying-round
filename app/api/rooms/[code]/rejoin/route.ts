import { getEngine } from "@/lib/server/engine";
import { recordTransferFail, teamToken, transferBlocked } from "@/lib/server/auth";
import { fail, handle, normCode, ok, readJson } from "@/lib/server/http";
import { GameError } from "@/lib/game/state-machine";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

/**
 * Moves a team to this device with the one-time code the host gave them.
 * The team keeps its score; the old device is signed out.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const code = normCode((await ctx.params).code);
    if (await transferBlocked(code)) return fail(429, "Too many wrong codes. Wait 15 minutes or ask the host.", "TOO_MANY");
    const body = await readJson<{ transfer_code?: string }>(req);
    try {
      const { team, device } = await getEngine().claimTransfer(code, String(body.transfer_code ?? ""));
      return ok({ room_code: code, team_id: team.team_id, name: team.name, token: teamToken(code, team.team_id, device), device });
    } catch (e) {
      if (e instanceof GameError && e.code === "BAD_REQUEST") await recordTransferFail(code);
      throw e;
    }
  });
}
