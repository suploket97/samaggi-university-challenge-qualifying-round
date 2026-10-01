"use client";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ScoreRow } from "@/lib/game/types";
import { rowsByScore } from "@/lib/game/scoring";
import { cx } from "./ui";
import { Odometer } from "./Odometer";

/**
 * Animated standings. Starts in the previous order, then re-sorts so teams
 * visibly overtake each other.
 */
export function Leaderboard({
  rows: input, limit = 10, highlight, final = false, byScore = false,
}: {
  rows: ScoreRow[];
  limit?: number;
  highlight?: string;
  /** The standings after the last question: medal colours for the top three. */
  final?: boolean;
  /** Position by score alone, "4=" for shared scores, tied teams by name: the tie-break is shown separately. */
  byScore?: boolean;
}) {
  const scored = byScore ? rowsByScore(input) : null;
  const rows: ScoreRow[] = scored ? scored.map((r) => ({ ...r, rank: r.position })) : input;
  const shared = new Set(scored?.filter((r) => r.shared).map((r) => r.team_id) ?? []);
  const [settled, setSettled] = useState(false);
  // Replay the animation only when the standings really change, not on every re-render.
  const rowsKey = rows.map((r) => `${r.team_id}:${r.score}:${r.rank}`).join("|");
  useEffect(() => {
    setSettled(false);
    const t = setTimeout(() => setSettled(true), 900);
    return () => clearTimeout(t);
  }, [rowsKey]);

  const ordered = settled
    ? rows
    : [...rows].sort((a, b) => (a.previous_rank ?? 1e9) - (b.previous_rank ?? 1e9) || a.rank - b.rank);
  const shown = ordered.slice(0, limit);
  const top = Math.max(1, ...rows.map((r) => r.score));

  return (
    <ol className="flex w-full flex-col gap-2">
      {shown.map((r) => {
        const move = r.previous_rank !== null ? r.previous_rank - r.rank : 0;
        // Everyday standings stay near-black; amber marks the leader. The final table gets gold, silver and bronze.
        const place = settled ? r.rank : null;
        const medal = final && place === 1 ? "card-metal-gold"
          : final && place === 2 ? "card-metal-silver"
          : final && place === 3 ? "card-metal-bronze"
          : r.rank === 1 ? "bg-gold text-ink" : "bg-panel-2 text-white";
        // On the final table the whole row carries the medal colour too.
        const rowTint = final && place !== null && place <= 3
          ? { borderColor: ["#ffd700", "#c0c0c0", "#cd7f32"][place - 1], boxShadow: `0 0 24px ${["rgb(255 215 0 / .25)", "rgb(192 192 192 / .25)", "rgb(205 127 50 / .25)"][place - 1]}` }
          : undefined;
        return (
          <motion.li
            key={r.team_id}
            layout
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className={cx(
              "relative flex items-center gap-4 overflow-hidden rounded-2xl border border-line bg-panel px-4 py-3",
              highlight === r.team_id && "border-gold",
            )}
            style={rowTint}
          >
            <motion.div
              className="absolute inset-y-0 left-0 bg-gold/10"
              initial={false}
              animate={{ width: settled ? `${(r.score / top) * 100}%` : "0%" }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
            <span className={cx("relative grid h-11 min-w-11 shrink-0 px-1.5 place-items-center rounded-xl font-mono text-xl font-bold tabular", medal)}>
              {settled ? `${r.rank}${shared.has(r.team_id) ? "=" : ""}` : r.previous_rank ?? "–"}
            </span>
            <span className="relative flex-1 truncate font-headline text-xl font-semibold md:text-2xl">{r.name}</span>
            {settled && move !== 0 ? (
              <span className={cx("relative text-sm font-bold animate-pop", move > 0 ? "text-good" : "text-bad")}>
                {move > 0 ? `▲${move}` : `▼${-move}`}
              </span>
            ) : null}
            <span className="relative w-24 text-right text-3xl text-white">
              <Odometer key={`${r.team_id}:${r.previous_score}:${r.score}`} from={r.previous_score ?? 0} value={r.score} delayMs={900} />
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}
