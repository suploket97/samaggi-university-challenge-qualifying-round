import { ADMIN_COOKIE } from "@/lib/server/auth";
import { ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = ok({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
