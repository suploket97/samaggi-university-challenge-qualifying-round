import "server-only";
import { NextResponse } from "next/server";
import { GameError } from "@/lib/game/state-machine";
import { ConfigError } from "./env";
import { isAdmin, verifyTeamToken } from "./auth";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });
}

const STATUS: Record<GameError["code"], number> = {
  ROOM_NOT_FOUND: 404,
  ILLEGAL_TRANSITION: 409,
  VERSION_CONFLICT: 409,
  TIMER_NOT_EXPIRED: 409,
  NO_MORE_QUESTIONS: 409,
  NO_PACK: 400,
  BAD_REQUEST: 400,
};

/** Wraps a handler so thrown errors become clean JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GameError) return fail(STATUS[e.code] ?? 400, e.message, e.code);
    if (e instanceof ConfigError) return fail(503, e.message, "CONFIG");
    console.error(e);
    return fail(500, "Something went wrong on the server");
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function normCode(code: string): string {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export async function requireAdmin(): Promise<Response | null> {
  return (await isAdmin()) ? null : fail(401, "Admin login required", "UNAUTHORIZED");
}

/** Reads x-team-id / x-team-token headers and checks them. */
export function teamFromRequest(req: Request, code: string): string | null {
  const id = req.headers.get("x-team-id") ?? "";
  const token = req.headers.get("x-team-token") ?? "";
  return verifyTeamToken(code, id, token) ? id : null;
}
