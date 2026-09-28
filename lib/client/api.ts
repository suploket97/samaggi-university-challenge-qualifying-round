"use client";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public body?: unknown) {
    super(message);
  }
}

export interface Timed<T> {
  data: T;
  /** Midpoint of request/response, for estimating the server clock offset. */
  localMid: number;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  return (await apiTimed<T>(path, init)).data;
}

export async function apiTimed<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Timed<T>> {
  const { json, headers, ...rest } = init;
  const t0 = Date.now();
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const t1 = Date.now();
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; code?: string };
    throw new ApiError(res.status, b.error ?? b.message ?? `Request failed (${res.status})`, b.code, body);
  }
  return { data: body as T, localMid: (t0 + t1) / 2 };
}

// ----- Player session (per room, per device) --------------------------------

export interface TeamSession {
  room_code: string;
  team_id: string;
  token: string;
  name: string;
}

const key = (code: string) => `pq:team:${code}`;

export function loadSession(code: string): TeamSession | null {
  try {
    const raw = localStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as TeamSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: TeamSession) {
  try {
    localStorage.setItem(key(s.room_code), JSON.stringify(s));
  } catch {
    /* private mode: session lasts for this tab only */
  }
}

export function clearSession(code: string) {
  try {
    localStorage.removeItem(key(code));
  } catch {
    /* ignore */
  }
}

export function teamHeaders(s: TeamSession): Record<string, string> {
  return { "x-team-id": s.team_id, "x-team-token": s.token };
}
