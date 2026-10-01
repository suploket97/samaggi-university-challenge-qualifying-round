import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ConfigError, env } from "./env";
import { getRedis } from "./redis";
import { hashPassword, verifyPassword, type StoredPassword } from "./password";

export const ADMIN_COOKIE = "pq_admin";
const AUTH_KEY = "admin:auth"; // Redis: the host password's salt + hash (never the password itself)
const SESSION_MAX_AGE = 60 * 60 * 24 * 14;

/**
 * Secret for signing session cookies and team tokens. SESSION_SECRET if set,
 * otherwise derived from a server-only key the app already has. It no longer
 * depends on the host password.
 */
function secret(): string {
  if (env.sessionSecret) return env.sessionSecret;
  const base = env.supabaseServiceKey ?? env.redisToken ?? env.redisTcpUrl;
  if (!base) throw new ConfigError("The database isn't connected yet. Connect Supabase and Upstash in Vercel → Storage, then redeploy");
  return createHash("sha256").update(`pq-session-v2:${base}`).digest("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ----- Host password ---------------------------------------------------------

export type AuthMode = "unset" | "stored" | "env";

async function readStored(): Promise<StoredPassword | null> {
  const raw = await getRedis().get(AUTH_KEY);
  return raw ? (JSON.parse(raw) as StoredPassword) : null;
}

/** "env": ADMIN_PASSWORD is set in Vercel (it wins). "stored": set up in the app. "unset": first visit. */
export async function authMode(): Promise<AuthMode> {
  if (env.adminPassword) return "env";
  return (await readStored()) ? "stored" : "unset";
}

export async function checkAdminPassword(given: string): Promise<boolean> {
  if (env.adminPassword) return safeEqual(sign(`pw:${given}`), sign(`pw:${env.adminPassword}`));
  const rec = await readStored();
  return !!rec && (await verifyPassword(given, rec));
}

/** First-time setup. Only succeeds while no password exists (atomic, so two people can't both claim it). */
export async function createAdminPassword(pw: string): Promise<boolean> {
  if (env.adminPassword) return false;
  const rec = await hashPassword(pw);
  const res = await getRedis().set(AUTH_KEY, JSON.stringify(rec), { nx: true });
  epochCache = null;
  return res === "OK";
}

/** Replaces the password. A new epoch signs every other session out. */
export async function replaceAdminPassword(pw: string): Promise<void> {
  const rec = await hashPassword(pw);
  await getRedis().set(AUTH_KEY, JSON.stringify(rec));
  epochCache = null;
}

// ----- Sessions ----------------------------------------------------------------

let epochCache: { at: number; value: string | null } | null = null;

/** Changes when the password changes, so old session cookies stop working. */
async function sessionEpoch(): Promise<string | null> {
  if (env.adminPassword) return sign(`env-epoch:${env.adminPassword}`);
  if (epochCache && Date.now() - epochCache.at < 5000) return epochCache.value;
  const rec = await readStored();
  epochCache = { at: Date.now(), value: rec?.epoch ?? null };
  return epochCache.value;
}

export async function adminCookieValue(): Promise<string> {
  const epoch = await sessionEpoch();
  if (!epoch) throw new ConfigError("No host password has been set yet");
  return sign(`admin-session-v2:${epoch}`);
}

export const adminCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE,
};

export async function isAdmin(): Promise<boolean> {
  try {
    const jar = await cookies();
    const v = jar.get(ADMIN_COOKIE)?.value;
    if (!v) return false;
    const epoch = await sessionEpoch();
    return !!epoch && safeEqual(v, sign(`admin-session-v2:${epoch}`));
  } catch {
    return false;
  }
}

// ----- Guessing protection ---------------------------------------------------

const MAX_FAILS = 10;
const FAIL_WINDOW_SEC = 15 * 60;

function clientKey(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return `admin:fails:${createHash("sha256").update(ip).digest("base64url").slice(0, 16)}`;
}

/** True when this device has had too many wrong passwords recently. */
export async function tooManyFailures(req: Request): Promise<boolean> {
  const n = Number((await getRedis().get(clientKey(req))) ?? 0);
  return n >= MAX_FAILS;
}

export async function recordFailure(req: Request): Promise<void> {
  const key = clientKey(req);
  const n = await getRedis().incr(key);
  if (n === 1) await getRedis().expire(key, FAIL_WINDOW_SEC);
}

export async function clearFailures(req: Request): Promise<void> {
  await getRedis().del(clientKey(req));
}

// ----- Teams -----------------------------------------------------------------

/** device 0 is the device the team joined on; each move to a new device gets the next number. */
export function teamToken(roomCode: string, teamId: string, device = 0): string {
  return sign(device ? `team:${roomCode}:${teamId}:${device}` : `team:${roomCode}:${teamId}`);
}

export function verifyTeamToken(roomCode: string, teamId: string, token: string, device = 0): boolean {
  if (!teamId || !token || !Number.isInteger(device) || device < 0) return false;
  return safeEqual(token, teamToken(roomCode, teamId, device));
}

// Wrong move-to-new-device codes, counted per room (everyone at the venue may share one IP).
const MAX_TRANSFER_FAILS = 20;
const transferKey = (roomCode: string) => `transfer:fails:${roomCode}`;

export async function transferBlocked(roomCode: string): Promise<boolean> {
  return Number((await getRedis().get(transferKey(roomCode))) ?? 0) >= MAX_TRANSFER_FAILS;
}

export async function recordTransferFail(roomCode: string): Promise<void> {
  const n = await getRedis().incr(transferKey(roomCode));
  if (n === 1) await getRedis().expire(transferKey(roomCode), FAIL_WINDOW_SEC);
}
