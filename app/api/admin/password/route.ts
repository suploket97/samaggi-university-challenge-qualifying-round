import { ADMIN_COOKIE, adminCookieOptions, adminCookieValue, authMode, checkAdminPassword, recordFailure, replaceAdminPassword, tooManyFailures } from "@/lib/server/auth";
import { passwordProblem } from "@/lib/server/password";
import { fail, handle, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Change the host password. Needs the current one; signs every other device out. */
export async function POST(req: Request) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    if ((await authMode()) === "env") {
      return fail(409, "This password is set by ADMIN_PASSWORD in Vercel. Change it there, or delete that variable to manage the password here.", "ENV_PASSWORD");
    }
    if (await tooManyFailures(req)) return fail(429, "Too many wrong passwords from this device. Wait 15 minutes and try again.", "TOO_MANY");
    const { current, next } = await readJson<{ current?: string; next?: string }>(req);
    if (!(await checkAdminPassword(String(current ?? "")))) {
      await recordFailure(req);
      return fail(401, "Your current password isn't right.", "WRONG_PASSWORD");
    }
    const pw = String(next ?? "");
    const problem = passwordProblem(pw);
    if (problem) return fail(400, problem, "WEAK_PASSWORD");
    await replaceAdminPassword(pw);
    // Keep this device signed in with a fresh cookie; all others are signed out.
    const res = ok({ ok: true });
    res.cookies.set(ADMIN_COOKIE, await adminCookieValue(), adminCookieOptions);
    return res;
  });
}
