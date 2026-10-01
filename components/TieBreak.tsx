"use client";

import type { TieBreakPayload } from "@/lib/game/types";
import { cx } from "@/components/ui";

/** 222817 ms → "3:42.8" (or "48.2 s" under a minute). */
export function formatTieTime(ms: number): string {
  const tenths = Math.round(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)} s`;
}

/**
 * The "photo finish" for the qualification cut. Teams level on score are
 * compared on correct answers, then total time on correct answers. Columns
 * appear one at a time, then the verdict.
 */
export function TieBreakReveal({ tb }: { tb: TieBreakPayload }) {
  const firstOut = tb.rows.findIndex((r) => !r.qualified);
  const usesTime = tb.decided_by === "TIME" || tb.decided_by === "NONE";
  const verdictDelay = usesTime ? 3.4 : 2.2;
  const delay = (s: number) => ({ animationDelay: `${s}s` });
  const headline =
    tb.decided_by === "CORRECT" ? "Decided by correct answers"
    : tb.decided_by === "TIME" ? "Same correct answers: decided by time"
    : "Level on all three at the cut: all go through";

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col justify-center">
      <p className="text-center text-xl font-semibold uppercase tracking-[0.35em] text-gold">Tie-break at the cut</p>
      <h1 className="mt-3 text-center font-headline text-6xl">
        {tb.rows.length} teams level on <span className="font-mono text-gold">{tb.score}</span> points
      </h1>
      <p className="mt-2 text-center text-2xl text-muted">Top {tb.qualify_count} qualify. Same score, so it goes to the tie-break.</p>

      <div className="mt-10 overflow-hidden rounded-3xl border border-line bg-panel">
        <div className="grid grid-cols-[1fr_14rem_16rem_12rem] items-center gap-4 border-b border-line px-8 py-4 text-lg font-semibold uppercase tracking-wider text-muted">
          <span>Team</span>
          <span className="text-center">① Correct answers</span>
          <span className={cx("text-center", !usesTime && "opacity-40")}>② Time on correct</span>
          <span className="text-right">Result</span>
        </div>
        {tb.rows.map((r, i) => (
          <div key={r.team_id}>
            {i === firstOut ? (
              <div className="relative h-0 border-t-4 border-dashed border-gold animate-rise" style={delay(verdictDelay)}>
                <span className="absolute -top-4 left-8 rounded-full bg-gold px-3 py-0.5 text-sm font-bold uppercase tracking-wider text-ink">Cut</span>
              </div>
            ) : null}
            <div className="grid grid-cols-[1fr_14rem_16rem_12rem] items-center gap-4 px-8 py-5">
              <span className="truncate font-headline text-4xl">{r.name}</span>
              <span className="text-center font-mono text-5xl font-bold tabular animate-pop" style={delay(1 + i * 0.15)}>
                {r.correct_count}
              </span>
              <span
                className={cx("text-center font-mono text-4xl tabular animate-pop", usesTime ? "text-white" : "text-muted/50")}
                style={delay(usesTime ? 2.2 + i * 0.15 : 1.4 + i * 0.15)}
              >
                {formatTieTime(r.total_correct_time_ms)}
              </span>
              <span className="flex justify-end animate-pop" style={delay(verdictDelay + 0.3 + i * 0.12)}>
                {r.qualified ? (
                  <span className="rounded-full bg-good/20 px-4 py-1.5 text-2xl font-bold text-good">✓ Through</span>
                ) : (
                  <span className="rounded-full bg-bad/15 px-4 py-1.5 text-2xl font-bold text-bad">✗ Out</span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center font-headline text-4xl text-gold animate-rise" style={delay(verdictDelay)}>
        {headline}
      </p>
    </div>
  );
}
