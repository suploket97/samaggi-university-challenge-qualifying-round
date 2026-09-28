import { ADMIN_COOKIE, adminCookieOptions, adminCookieValue, authMode, checkAdminPassword, clearFailures, recordFailure, tooManyFailures } from "@/lib/server/auth";
import { fail, handle, ok, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    if ((await authMode()) === "unset") return fail(409, "No host password yet. Create one first.", "NO_PASSWORD");
    if (await tooManyFailures(req)) {
      return fail(429, "Too many wrong passwords from this device. Wait 15 minutes and try again.", "TOO_MANY");
    }
    const { password } = await readJson<{ password?: string }>(req);
    if (!password || !(await checkAdminPassword(String(password)))) {
      await recordFailure(req);
      await new Promise((r) => setTimeout(r, 500)); // slow down guessing
      return fail(401, "That password isn't right.", "WRONG_PASSWORD");
    }
    await clearFailures(req);
    const res = ok({ ok: true });
    res.cookies.set(ADMIN_COOKIE, await adminCookieValue(), adminCookieOptions);
    return res;
  });
}
