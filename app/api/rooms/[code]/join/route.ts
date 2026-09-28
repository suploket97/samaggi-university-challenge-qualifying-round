import { getEngine } from "@/lib/server/engine";
import { teamToken } from "@/lib/server/auth";
import { handle, normCode, ok, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const code = normCode((await ctx.params).code);
    const body = await readJson<{ name?: string }>(req);
    const team = await getEngine().joinTeam(code, String(body.name ?? ""));
    return ok({ room_code: code, team_id: team.team_id, name: team.name, token: teamToken(code, team.team_id) });
  });
}
