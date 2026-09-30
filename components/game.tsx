"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Choice, MediaControl, PublicQuestion } from "@/lib/game/types";
import { cx } from "./ui";

/**
 * Choices are neutral charcoal tiles with a light letter badge: accents in
 * this theme are semantic, so colour appears only when it means something
 * (amber = your pick, emerald = correct at the reveal).
 */
export function choiceColor(_id: string): string {
  return "#e4e4e7";
}

/** Inline style for a choice tile or button. `strength` > 0.3 marks a selected tile. */
export function choiceTileStyle(_id: string, strength = 0.22): React.CSSProperties {
  return strength > 0.3
    ? { backgroundColor: "rgba(245, 158, 11, 0.16)", borderColor: "#f59e0b" }
    : { backgroundColor: "#131318", borderColor: "#2a2a33" };
}

/** Grid columns for a set of choices on the big screen. */
export function stageChoiceColumns(n: number, withMedia: boolean): number {
  if (withMedia) return n <= 4 ? 1 : n <= 10 ? 2 : 3;
  return n <= 2 ? 1 : n <= 8 ? 2 : n <= 15 ? 3 : 4;
}

/** Circular countdown. `remainingMs` comes from the server-synced clock. */
export function Countdown({ remainingMs, totalSec, size = 120 }: { remainingMs: number; totalSec: number; size?: number }) {
  const secs = Math.ceil(remainingMs / 1000);
  const frac = totalSec > 0 ? Math.max(0, Math.min(1, remainingMs / (totalSec * 1000))) : 0;
  const r = 44;
  const c = 2 * Math.PI * r;
  const urgent = secs <= 5;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-white/10" />
        <circle
          cx="50" cy="50" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
          stroke="currentColor"
          className={cx("transition-[stroke-dashoffset] duration-200 ease-linear", urgent ? "text-bad" : "text-gold")}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <span
        className={cx("absolute inset-0 grid place-items-center font-mono font-bold tabular", urgent && "text-bad")}
        style={{ fontSize: size * 0.36 }}
      >
        {secs}
      </span>
    </div>
  );
}

export function TimerBar({ remainingMs, totalSec }: { remainingMs: number; totalSec: number }) {
  const frac = totalSec > 0 ? Math.max(0, Math.min(1, remainingMs / (totalSec * 1000))) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={cx("h-full rounded-full transition-[width] duration-200 ease-linear", frac < 0.2 ? "bg-bad" : "bg-gold")}
        style={{ width: `${frac * 100}%` }}
      />
    </div>
  );
}

/** An image that shows a clear message instead of a broken icon if it can't load. */
export function SafeImage({ src, className, onClick }: { src: string; className?: string; onClick?: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) {
    return (
      <div className={cx("grid min-h-24 place-items-center rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted", className)}>
        Picture couldn&apos;t load
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      onClick={onClick}
      className={cx("rounded-2xl object-contain", onClick && "cursor-zoom-in", className)}
    />
  );
}

export function QuestionMedia({
  q,
  className,
  onZoom,
  autoPlay = true,
  control,
}: {
  q: PublicQuestion;
  className?: string;
  onZoom?: () => void;
  autoPlay?: boolean;
  /** The host's play/pause/restart presses (big screen only). */
  control?: MediaControl | null;
}) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const seq = control?.seq ?? 0;
  useEffect(() => {
    const el = ref.current;
    if (!el || !control || !seq) return;
    if (control.action === "PAUSE") {
      el.pause();
      return;
    }
    if (control.action === "RESTART") el.currentTime = 0;
    el.play().catch(() => {
      /* the browser wants a click on this page first; the host console says so */
    });
    // Only a new press (seq) should act, not re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  if (!q.media_url) return null;
  if (q.media_type === "audio") {
    return (
      <div className={cx("flex w-full flex-col items-center gap-4 rounded-3xl bg-panel/70 p-6", className)}>
        <span className="text-6xl">🎵</span>
        <audio ref={(el: HTMLAudioElement | null) => { ref.current = el; }} src={q.media_url} controls autoPlay={autoPlay} className="w-full max-w-xl" />
      </div>
    );
  }
  if (q.media_type === "video") {
    return <video ref={(el: HTMLVideoElement | null) => { ref.current = el; }} src={q.media_url} controls autoPlay={autoPlay} playsInline className={cx("max-h-full max-w-full rounded-2xl", className)} />;
  }
  return <SafeImage src={q.media_url} className={cx("max-h-full max-w-full", className)} onClick={onZoom} />;
}

/** Full-screen picture viewer for phones (pinch to zoom works natively). */
export function ZoomOverlay({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={onClose} role="dialog" aria-label="Picture">
      <div className="flex justify-end p-3">
        <button className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold" onClick={onClose}>Close ✕</button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2" style={{ touchAction: "pinch-zoom" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  );
}

export function ChoiceBadge({ id, className }: { id: string; className?: string }) {
  return (
    <span
      className={cx("grid shrink-0 place-items-center rounded-lg font-display font-bold text-ink", className ?? "h-10 w-10 text-xl")}
      style={{ backgroundColor: choiceColor(id) }}
    >
      {id}
    </span>
  );
}

/** Stage choice tile, optionally showing the reveal result. */
export function StageChoice({
  choice, state, count, total, dense = false,
}: {
  choice: Choice;
  state: "open" | "locked" | "correct" | "wrong";
  count?: number;
  total?: number;
  /** Many choices on screen: smaller tile and text. */
  dense?: boolean;
}) {
  const pct = total && count !== undefined ? Math.round((count / Math.max(1, total)) * 100) : null;
  return (
    <div
      className={cx(
        "relative flex items-center overflow-hidden rounded-2xl border-2 text-white transition-all duration-500",
        dense ? "gap-2 p-2" : "gap-4 p-4 md:p-5",
        state === "locked" && "opacity-70",
        state === "wrong" && "opacity-25 grayscale",
        state === "correct" && "!border-good ring-4 ring-good/60 animate-glow scale-[1.02]",
      )}
      style={state === "correct" ? { backgroundColor: "rgba(16, 185, 129, 0.22)" } : choiceTileStyle(choice.choice_id)}
    >
      {pct !== null ? (
        <div className="absolute inset-y-0 left-0 bg-black/20 transition-[width] duration-1000" style={{ width: `${pct}%` }} />
      ) : null}
      <ChoiceBadge id={choice.choice_id} className={cx("relative", dense ? "h-9 w-9 text-lg" : "h-12 w-12 text-2xl")} />
      {choice.media_url ? <SafeImage src={choice.media_url} className={cx("relative shrink-0 bg-black/20 object-cover", dense ? "h-14 w-20" : "h-24 w-32 md:h-28 md:w-40")} /> : null}
      {choice.text ? <span className={cx("relative flex-1 font-display font-semibold leading-snug", dense ? "text-lg md:text-xl" : "text-2xl md:text-3xl")}>{choice.text}</span> : <span className="flex-1" />}
      {state === "correct" ? <span className={cx("relative text-good", dense ? "text-2xl" : "text-4xl")}>✔</span> : null}
      {count !== undefined ? <span className="relative font-mono text-2xl font-bold tabular">{count}</span> : null}
    </div>
  );
}

/**
 * Shrinks its text until it fits its box, so a long passage never spills off
 * the projector. Size children in `em` so they scale with it.
 *
 * The box is limited either by `maxHeight` (e.g. "32vh") or, with `fill`, by
 * the space its flex parent gives it. The font is the largest size between
 * `min` and `max` (px) that fits; if even `min` doesn't fit, the box scrolls.
 */
export function FitText({
  children, max, min = 16, maxHeight, fill = false, className, as: Tag = "div", watch,
}: {
  children: React.ReactNode;
  max: number;
  min?: number;
  maxHeight?: string;
  fill?: boolean;
  className?: string;
  as?: "div" | "h1" | "ol" | "ul";
  /** Refit when this changes. Pass a string (e.g. the text), not an object that is rebuilt each render. */
  watch?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [overflow, setOverflow] = useState(false);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Hidden or not laid out yet: measure again when it gets a size (ResizeObserver).
    if (el.clientWidth === 0) return;
    const fits = (px: number) => {
      el.style.fontSize = px + "px";
      return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    };
    // Entrance animations move children and would count as overflow, so pause them while measuring.
    el.setAttribute("data-measuring", "");
    try {
      if (fits(max)) return setOverflow(false);
      let lo = min, hi = max;
      if (!fits(lo)) return setOverflow(true);
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (fits(mid)) lo = mid; else hi = mid;
      }
      fits(lo);
      setOverflow(false);
    } finally {
      el.removeAttribute("data-measuring");
    }
  }, [max, min]);

  // `watch` should be a string (e.g. the text) so this runs when content changes, not on every render.
  useLayoutEffect(() => {
    fit();
  }, [fit, watch]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    // Web fonts arrive after first paint and change the text width.
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [fit]);

  return (
    <Tag
      ref={ref as never}
      className={cx(fill && "min-h-0 flex-1", overflow ? "overflow-y-auto" : "overflow-hidden", className)}
      style={{ maxHeight, fontSize: max }}
    >
      {children}
    </Tag>
  );
}

/** Rough size class for the question on a phone: long passages get smaller type. */
export function phoneQuestionSize(text: string): string {
  const n = text.length;
  if (n > 400) return "text-sm";
  if (n > 200) return "text-base";
  if (n > 100) return "text-lg";
  return "text-xl";
}
