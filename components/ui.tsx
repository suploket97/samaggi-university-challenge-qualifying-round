"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "good";

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const v: Record<Variant, string> = {
    primary: "bg-gold text-ink hover:brightness-110 shadow-[0_8px_24px_-8px_rgb(245_158_11/0.6)]",
    secondary: "bg-panel-2 text-white border border-line hover:border-muted",
    danger: "bg-bad/15 text-bad border border-bad/40 hover:bg-bad/25",
    ghost: "text-muted hover:text-white hover:bg-white/5",
    good: "bg-good text-ink hover:brightness-110",
  };
  const s = { sm: "h-9 px-3 text-sm", md: "h-11 px-5 text-base", lg: "h-14 px-7 text-lg" }[size];
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        v[variant],
        s,
        className,
      )}
    >
      {loading ? <Spinner className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl border border-line bg-panel/80 backdrop-blur", className)}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "h-5 w-5")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingDots({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex gap-2", className)} aria-label="Loading">
      <span className="loading-dot h-3 w-3 rounded-full bg-current" />
      <span className="loading-dot h-3 w-3 rounded-full bg-current" />
      <span className="loading-dot h-3 w-3 rounded-full bg-current" />
    </span>
  );
}

/** Event name lockup: "Samaggi University Challenge" over "Qualifying Round". */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cx("inline-flex flex-col leading-none", className)}>
      <span className="font-headline text-[1.15em]">
        <span className="text-gold">Samaggi</span> University Challenge
      </span>
      {compact ? null : (
        <span className="mt-[0.3em] font-sans text-[0.42em] font-bold uppercase tracking-[0.3em] text-muted">Qualifying Round</span>
      )}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted/80">{hint}</span> : null}
    </label>
  );
}

const inputBase =
  "rounded-xl border border-line bg-ink/60 text-white placeholder:text-muted/60 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30";
export const inputClass = `${inputBase} w-full h-12 px-4`;

/**
 * Input styles with size overrides. Tailwind picks between two width (or
 * height) classes by stylesheet order, not by the order you write them, so
 * the defaults (w-full, h-12, px-4) are left out whenever you pass your own.
 */
export function inputCls(...extra: (string | false | null | undefined)[]): string {
  const e = cx(...extra);
  const has = (re: RegExp) => re.test(" " + e);
  return cx(
    inputBase,
    !has(/\s(w|flex|basis)-/) && "w-full",
    !has(/\sh-/) && "h-12",
    !has(/\s(px|p)-/) && "px-4",
    e,
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{children}</p>;
}

export function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={connected ? "Live" : "Reconnecting — updates every few seconds"}>
      <span className={cx("h-2 w-2 rounded-full", connected ? "bg-good" : "bg-bad animate-pulse")} />
      {connected ? "Live" : "Syncing"}
    </span>
  );
}
