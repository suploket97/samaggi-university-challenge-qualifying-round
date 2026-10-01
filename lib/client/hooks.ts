"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicSnapshot } from "@/lib/game/engine";
import { apiTimed } from "./api";
import { getBrowserSupabase } from "./realtime";

/** Re-renders every `ms` milliseconds and returns Date.now(). */
export function useNow(ms = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export interface RoomConnection {
  snapshot: PublicSnapshot | null;
  error: string | null;
  notFound: boolean;
  connected: boolean;
  /** Milliseconds to add to Date.now() to get the server clock. */
  offset: number;
  refresh: () => Promise<void>;
  apply: (s: PublicSnapshot, localMid?: number) => void;
}

/**
 * Keeps the newest room snapshot. Sources: an initial fetch, Supabase
 * Realtime broadcasts, and a slow heartbeat poll as a safety net (faster when
 * the realtime connection is down). Older versions are ignored, so
 * out-of-order delivery can't roll the screen back.
 */
export function useRoom(
  code: string,
  loader?: () => Promise<{ snapshot: PublicSnapshot; localMid: number }>,
): RoomConnection {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [connected, setConnected] = useState(false);
  const [offset, setOffset] = useState(0);
  const versionRef = useRef(-1);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const apply = useCallback((s: PublicSnapshot, localMid?: number) => {
    if (localMid !== undefined) setOffset(s.server_now - localMid);
    if (s.version < versionRef.current) return;
    versionRef.current = s.version;
    setSnapshot(s);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = loaderRef.current
        ? await loaderRef.current()
        : await apiTimed<{ snapshot: PublicSnapshot }>(`/api/rooms/${code}/state`).then((r) => ({
            snapshot: r.data.snapshot,
            localMid: r.localMid,
          }));
      apply(res.snapshot, res.localMid);
      setError(null);
      setNotFound(false);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err.status === 404) setNotFound(true);
      else setError(err.message ?? "Connection problem");
    }
  }, [apply, code]);

  // Realtime subscription
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    getBrowserSupabase().then((sb) => {
      if (cancelled || !sb) return;
      const channel = sb
        .channel(`room:${code}`, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "state" }, (msg: { payload?: { snapshot?: PublicSnapshot } }) => {
          if (msg.payload?.snapshot) apply(msg.payload.snapshot);
        })
        .subscribe((status: string) => {
          const ok = status === "SUBSCRIBED";
          setConnected(ok);
          if (ok) void refresh(); // catch anything missed while connecting
        });
      cleanup = () => {
        void sb.removeChannel(channel);
      };
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [code, apply, refresh]);

  // Initial load + heartbeat + refresh when the tab comes back
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), connected ? 15000 : 3000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onVis);
    };
  }, [refresh, connected]);

  return { snapshot, error, notFound, connected, offset, refresh, apply };
}

/**
 * When the countdown reaches zero, ask the server to close the question.
 * The server ignores early or repeated calls, so every screen can do this.
 */
export function useAutoTick(code: string, room: RoomConnection, extraDelayMs = 250) {
  const { snapshot, offset, apply } = room;
  const endsAt = snapshot?.phase === "PLAYING" ? snapshot.question_ends_at : null;
  const version = snapshot?.version;

  useEffect(() => {
    if (endsAt === null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const fire = async () => {
      if (stopped) return;
      attempts++;
      try {
        const r = await apiTimed<{ snapshot: PublicSnapshot }>(`/api/rooms/${code}/tick`, { method: "POST" });
        apply(r.data.snapshot, r.localMid);
        if (r.data.snapshot.phase !== "PLAYING") return;
      } catch {
        /* retry below */
      }
      if (attempts < 15 && !stopped) timer = setTimeout(fire, 1500);
    };
    const wait = Math.max(0, endsAt - (Date.now() + offset)) + extraDelayMs;
    timer = setTimeout(fire, wait);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [code, endsAt, version, offset, apply, extraDelayMs]);
}

/** Polls a URL while `active`. Returns the latest data. */
export function usePoll<T>(url: string | null, intervalMs: number, active = true): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url || !active) return;
    let stopped = false;
    const load = async () => {
      try {
        const r = await apiTimed<T>(url);
        if (!stopped) {
          setData(r.data);
          setError(null);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    void load();
    const id = setInterval(load, intervalMs);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [url, intervalMs, active, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

/**
 * Anti-cheat for the player screen while a question is open:
 *  - Page Visibility: hidden for >= thresholdMs gets reported (even if the
 *    player never comes back, via a keepalive request after the threshold).
 *  - Copy and the context menu are blocked on the page.
 */
export function useAntiCheat(opts: {
  active: boolean;
  thresholdMs: number;
  report: (durationMs: number, kind: "FOCUS_LOST" | "PASTE_ATTEMPT" | "WINDOW_BLUR") => void;
}) {
  const { active, thresholdMs, report } = opts;
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    if (!active) return;
    let hiddenAt: number | null = null;
    let reported = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        reported = false;
        timer = setTimeout(() => {
          reported = true;
          reportRef.current(thresholdMs, "FOCUS_LOST");
        }, thresholdMs);
      } else if (hiddenAt !== null) {
        if (timer) clearTimeout(timer);
        const d = Date.now() - hiddenAt;
        hiddenAt = null;
        if (!reported && d >= thresholdMs) reportRef.current(d, "FOCUS_LOST");
      }
    };
    const block = (e: Event) => e.preventDefault();

    // Computers: another window in front of a quiz page that is still visible. Only flagged
    // for the judges (a click on the taskbar or address bar looks the same), never voided.
    let blurAt: number | null = null;
    const onBlur = () => {
      if (document.visibilityState === "visible") blurAt = Date.now();
    };
    const onFocus = () => {
      if (blurAt === null) return;
      const d = Date.now() - blurAt;
      blurAt = null;
      if (document.visibilityState === "visible" && d >= thresholdMs) reportRef.current(d, "WINDOW_BLUR");
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") blurAt = null; // counted as leaving the screen instead
    };

    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    document.addEventListener("contextmenu", block);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
      document.removeEventListener("contextmenu", block);
    };
  }, [active, thresholdMs]);
}
