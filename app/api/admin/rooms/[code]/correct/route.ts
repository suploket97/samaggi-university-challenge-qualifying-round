import { getEngine } from "@/lib/server/engine";
import { fail, handle, normCode, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

/** The grouped answers of a question that has been revealed: GET ?question=<index>. */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const code = normCode((await ctx.params).code);
    const qi = Number(new URL(req.url).searchParams.get("question"));
    if (!Number.isInteger(qi) || qi < 0) return fail(400, "Send ?question=<index>");
    return ok({ review: await getEngine().revealedReview(code, qi) });
  });
}

/**
 * Correct a revealed question (a challenge upheld): mark a group of answers
 * right or wrong; that question is re-scored and the leaderboard adjusted.
 * Body: { question_index, key, verdict: "CORRECT" | "WRONG" | null }.
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
    return ok(await getEngine().correctRevealed(code, { question_index: qi, key, verdict }));
  });
}
