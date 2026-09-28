"use client";
import { useEffect, useState } from "react";
import { cx } from "./ui";

/**
 * Odometer-style number: each digit is a vertical wheel that rolls forward
 * from the old value to the new one, lower digits taking a little longer,
 * like a mechanical counter. Share Tech Mono keeps every digit the same width.
 *
 * Remount it (via `key`) when a new from→to pair arrives, so it never rolls backwards.
 */
export function Odometer({
  value,
  from,
  delayMs = 0,
  className,
}: {
  value: number;
  from?: number | null;
  delayMs?: number;
  className?: string;
}) {
  const to = Math.max(0, Math.round(value));
  const start = Math.max(0, Math.round(from ?? to));
  const [rolling, setRolling] = useState(start === to);
  const [reduce, setReduce] = useState(false);
  useEffect(() => setReduce(!!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches), []);

  useEffect(() => {
    if (start === to) return;
    const t = setTimeout(() => setRolling(true), delayMs + 30);
    return () => clearTimeout(t);
  }, [start, to, delayMs]);

  const len = Math.max(String(to).length, String(start).length);
  const oldStr = String(start).padStart(len, " ");
  const newStr = String(to).padStart(len, " ");

  return (
    <span className={cx("inline-flex font-mono leading-none", className)} aria-label={String(to)} role="img">
      {Array.from({ length: len }, (_, i) => {
        const place = len - 1 - i; // 0 = units
        const oldCh = oldStr[i];
        const newCh = newStr[i];
        // Wheel cells: [blank, 0-9, 0-9]. Index 0 is blank (a leading space).
        const idxOf = (ch: string) => (ch === " " ? 0 : 1 + Number(ch));
        let target = idxOf(rolling ? newCh : oldCh);
        if (rolling && newCh !== " ") {
          const p = 10 ** place;
          const changedHere = Math.floor(start / p) !== Math.floor(to / p);
          // Roll forward through 9→0 instead of backwards, the way a real counter turns.
          if (changedHere && oldCh !== " " && Number(newCh) <= Number(oldCh)) target += 10;
        }
        return (
          <span key={i} aria-hidden className="relative inline-block h-[1em] w-[0.6em] overflow-hidden">
            <span
              className="absolute left-0 top-0 flex flex-col"
              style={{
                transform: `translateY(-${target}em)`,
                transition: rolling && !reduce ? `transform ${1100 + place * 250}ms cubic-bezier(0.2, 0.75, 0.15, 1)` : "none",
              }}
            >
              {[" ", ..."01234567890123456789"].map((c, j) => (
                <span key={j} className="block h-[1em] text-center leading-none">
                  {c === " " ? " " : c}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
