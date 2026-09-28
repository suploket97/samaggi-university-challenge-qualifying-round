import { listCompetitions } from "@/lib/server/competitions";
import { handle, ok, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    return ok({ competitions: await listCompetitions() });
  });
}
