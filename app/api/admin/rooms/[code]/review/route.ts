import { getEngine } from "@/lib/server/engine";
import { fail, handle, normCode, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

/**
 * Host review before the reveal: mark a group of identical answers right or
 * wrong by hand. Body: { question_index, key, verdict: "CORRECT" | "WRONG" | null }
 * (null = back to automatic marking). Every change is written to the competition log.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const code = normCode((await ctx.params).code);
    const b = await readJson<{ question_index?: unknown; key?: unknown; verdict?: unknown }>(req);
    const qi = Number(b.question_index);
    const key = typeof b.key === "string" ? b.key : "";
    const verdict = b.verdict === "CORRECT" || b.verdict === "WRONG" ? b.verdict : b.verdict === null ? null : undefined;
    if (!Number.isInteger(qi) || qi < 0 || !key || key.length > 400 || verdict === undefined) return fail(400, "Send question_index, key and verdict (CORRECT, WRONG or null)");
    const review = await getEngine().setReview(code, { question_index: qi, key, verdict });
    return ok({ review });
  });
}
