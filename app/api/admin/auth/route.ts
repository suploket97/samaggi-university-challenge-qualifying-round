import { authMode, isAdmin } from "@/lib/server/auth";
import { ConfigError, relatedEnvNames } from "@/lib/server/env";
import { handle, ok } from "@/lib/server/http";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Tells the login page whether to show "create a password" or "log in".
 * If the databases aren't connected, it says so and lists the names (never the
 * values) of the database settings the project does have, so setup problems can
 * be fixed before anyone can log in.
 */
export async function GET() {
  try {
    return ok({ mode: await authMode(), signed_in: await isAdmin() });
  } catch (e) {
    if (e instanceof ConfigError) {
      return NextResponse.json(
        { error: e.message, code: "CONFIG", found: relatedEnvNames() },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return handle(async () => {
      throw e;
    });
  }
}
