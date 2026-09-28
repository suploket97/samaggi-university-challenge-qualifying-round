import { SupabaseBankRepo } from "@/lib/server/bank-repo";
import { referencedPacksNotInFile, validateImport } from "@/lib/bank/validate";
import { handle, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Body: { doc: ImportDoc, mode: "replace" | "append", dryRun: boolean }
 * Always validates. Writes only when dryRun is false and there are no issues.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const body = await readJson<{ doc?: unknown; mode?: string; dryRun?: boolean }>(req);
    const mode = body.mode === "append" ? "append" : "replace";

    const { doc, issues } = validateImport(body.doc);
    if (!doc) return ok({ ok: false, issues });

    // Questions may point at packs that already exist in the database.
    const repo = new SupabaseBankRepo();
    const external = referencedPacksNotInFile(doc);
    const existing = await repo.existingPackIds(external);
    const created = external.filter((id) => !existing.has(id));
    for (const id of created) doc.quiz_packs.push({ quiz_pack_id: id, title: id });

    const summary = {
      packs: [...new Set(doc.questions.map((q) => q.quiz_pack_id))],
      new_packs: created,
      question_count: doc.questions.length,
      by_type: doc.questions.reduce<Record<string, number>>((acc, q) => ((acc[q.type] = (acc[q.type] ?? 0) + 1), acc), {}),
    };
    if (body.dryRun) return ok({ ok: true, dryRun: true, summary, issues: [] });

    const result = await repo.importDoc(doc, mode);
    return ok({ ok: true, dryRun: false, summary, result, issues: [] });
  });
}
