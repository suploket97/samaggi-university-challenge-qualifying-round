import { ADMIN_COOKIE, adminCookieOptions, adminCookieValue, authMode, createAdminPassword } from "@/lib/server/auth";
import { passwordProblem } from "@/lib/server/password";
import { fail, handle, ok, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** First visit only: create the host password and sign in. */
export async function POST(req: Request) {
  return handle(async () => {
    if ((await authMode()) !== "unset") return fail(409, "A host password already exists. Log in instead.", "ALREADY_SET");
    const { password } = await readJson<{ password?: string }>(req);
    const pw = String(password ?? "");
    const problem = passwordProblem(pw);
    if (problem) return fail(400, problem, "WEAK_PASSWORD");
    if (!(await createAdminPassword(pw))) return fail(409, "A host password was just created. Log in instead.", "ALREADY_SET");
    const res = ok({ ok: true });
    res.cookies.set(ADMIN_COOKIE, await adminCookieValue(), adminCookieOptions);
    return res;
  });
}
