import { SupabaseBankRepo } from "@/lib/server/bank-repo";
import { fail, handle, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const id = decodeURIComponent((await ctx.params).id);
    const { question_ids } = await readJson<{ question_ids?: unknown }>(req);
    if (!Array.isArray(question_ids) || !question_ids.every((x) => typeof x === "string")) return fail(400, "question_ids must be a list");
    await new SupabaseBankRepo().reorder(id, question_ids as string[]);
    return ok({ ok: true });
  });
}
