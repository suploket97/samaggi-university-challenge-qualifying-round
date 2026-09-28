import { SupabaseBankRepo } from "@/lib/server/bank-repo";
import { validateImport } from "@/lib/bank/validate";
import type { BankQuestion } from "@/lib/game/types";
import { fail, handle, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Create or update one question from the editor. */
export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const id = decodeURIComponent((await ctx.params).id);
    const { question } = await readJson<{ question?: BankQuestion }>(req);
    if (!question || question.question_id !== id) return fail(400, "Question id doesn't match");
    const { doc, issues } = validateImport({ schema_version: 1, quiz_packs: [], questions: [question] });
    if (!doc) return ok({ ok: false, issues: issues.map((i) => i.message) }, { status: 422 });
    const repo = new SupabaseBankRepo();
    if ((await repo.existingPackIds([question.quiz_pack_id])).size === 0) return fail(400, "That pack doesn't exist any more");
    await repo.saveQuestion(doc.questions[0]);
    return ok({ ok: true });
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const { id } = await ctx.params;
    await new SupabaseBankRepo().deleteQuestion(decodeURIComponent(id));
    return ok({ ok: true });
  });
}
