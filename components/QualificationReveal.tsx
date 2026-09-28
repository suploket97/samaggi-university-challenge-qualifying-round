"use client";
import { useEffect, useState } from "react";
import type { ScoreRow } from "@/lib/game/types";
import { cx } from "./ui";
import { Particles } from "./Particles";

/**
 * Stage cinematic: a short build-up, then qualified teams appear one by one
 * from the last qualifying place up to first, then the eliminated teams fade in.
 */
export function QualificationReveal({ qualified, eliminated, qualifyCount }: { qualified: ScoreRow[]; eliminated: ScoreRow[]; qualifyCount: number }) {
  const [shown, setShown] = useState(0); // number of qualified teams revealed
  const [intro, setIntro] = useState(true);
  const total = qualified.length;
  const step = Math.max(350, Math.min(1400, 14000 / Math.max(1, total)));

  // The stage re-renders ten times a second (countdown clock), and each render
  // builds a new `qualified` array. Restart the cinematic only when the actual
  // list of teams changes, or it would restart forever and stick on the drum.
  const listKey = qualified.map((r) => r.team_id).join(",");
  useEffect(() => {
    setShown(0);
    setIntro(true);
    const t0 = setTimeout(() => setIntro(false), 2600);
    return () => clearTimeout(t0);
  }, [listKey]);

  useEffect(() => {
    if (intro || shown >= total) return;
    const t = setTimeout(() => setShown((n) => n + 1), step);
    return () => clearTimeout(t);
  }, [intro, shown, total, step]);

  // Reveal from the bottom of the qualifying list upward.
  const revealed = new Set(qualified.slice(total - shown).map((r) => r.team_id));
  const done = !intro && shown >= total;

  if (intro) {
    return (
      <div className="bg-metal-gold relative -mx-8 -mb-8 grid h-[calc(100%+2rem)] place-items-center overflow-hidden text-center">
        <Particles tone="gold" count={40} />
        <div className="relative animate-rise">
          <p className="font-headline text-5xl text-[#ffe99a] md:text-6xl">The top {qualifyCount} going through are…</p>
          <p className="mt-6 text-7xl animate-pulse md:text-8xl">🥁</p>
        </div>
      </div>
    );
  }

  const cols = total > 12 ? "grid-cols-3" : total > 5 ? "grid-cols-2" : "grid-cols-1";
  return (
    <div className="bg-metal-gold relative -mx-8 -mb-8 flex h-[calc(100%+2rem)] flex-col gap-6 overflow-hidden px-8 pb-8 pt-2">
      <Particles tone="gold" count={48} />
      <h2 className="text-metal-gold relative text-center font-headline text-6xl md:text-7xl">Qualified teams</h2>
      <ol className={cx("mx-auto grid w-full max-w-6xl gap-3", cols)}>
        {qualified.map((r) =>
          revealed.has(r.team_id) ? (
            <li
              key={r.team_id}
              className={cx(
                "relative flex items-center gap-4 rounded-2xl px-5 py-3 animate-pop",
                // Gold for 1st, silver for 2nd, bronze for 3rd, dark gold-edged cards for everyone else through.
                r.rank === 1 ? "card-metal-gold" : r.rank === 2 ? "card-metal-silver" : r.rank === 3 ? "card-metal-bronze" : "border border-metal-gold/50 bg-black/40 text-[#ffe99a]",
              )}
            >
              <span className="font-mono text-2xl">#{r.rank}</span>
              <span className="flex-1 truncate font-headline text-3xl">{r.name}</span>
              <span className="font-mono text-xl">{r.score}</span>
            </li>
          ) : (
            <li key={r.team_id} className="relative h-[60px] rounded-2xl border-2 border-dashed border-metal-gold/30" />
          ),
        )}
      </ol>
      {done && eliminated.length > 0 ? (
        <div className="relative mx-auto w-full max-w-6xl animate-rise">
          <p className="mb-3 text-center font-headline text-2xl text-muted">Not this time</p>
          <div className="flex flex-wrap justify-center gap-2">
            {eliminated.map((r) => (
              <span key={r.team_id} className="rounded-full border border-line bg-ink/80 px-3 py-1 text-muted">
                <span className="font-mono">#{r.rank}</span> {r.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
