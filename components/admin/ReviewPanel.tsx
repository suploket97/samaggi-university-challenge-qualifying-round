"use client";
import { useState } from "react";
import type { ReviewGroup, ReviewPayload } from "@/lib/game/review";
import type { Verdict } from "@/lib/game/scoring";
import { api, ApiError } from "@/lib/client/api";
import { Card, ErrorNote, cx } from "@/components/ui";

/**
 * Host review before the reveal (like a live answer wall): every answer that
 * has come in, identical answers grouped, each group markable right or wrong.
 * A decision covers every team that sent that answer, including teams that
 * answer later, and is written to the competition log straight away.
 */
export function ReviewPanel({ code, review, onChange }: { code: string; review: ReviewPayload; onChange: (r: ReviewPayload) => void }) {
  const [filter, setFilter] = useState<"all" | "wrong" | "right" | "changed">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isChoice = review.type === "MCQ_SINGLE" || review.type === "MCQ_MULTI" || review.type === "TRUE_FALSE";
  const isSequence = review.type === "ORDERING" || review.type === "MATCHING";

  async function mark(g: ReviewGroup, verdict: Verdict | null) {
    setBusy(g.key);
    setError(null);
    try {
      const r = await api<{ review: ReviewPayload }>(`/api/admin/rooms/${code}/review`, {
        method: "POST",
        json: { question_index: review.question_index, key: g.key, verdict },
      });
      onChange(r.review);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  const counts = {
    all: review.groups.length,
    wrong: review.groups.filter((g) => g.final === "WRONG").length,
    right: review.groups.filter((g) => g.final === "CORRECT").length,
    changed: review.groups.filter((g) => g.override).length,
  };
  const shown = review.groups.filter((g) => (filter === "all" ? true : filter === "wrong" ? g.final === "WRONG" : filter === "right" ? g.final === "CORRECT" : !!g.override));
  const sections: { title: string | null; groups: ReviewGroup[] }[] = review.parts
    ? review.parts.map((p, i) => ({ title: `${i + 1}. ${p}`, groups: shown.filter((g) => g.part === i) }))
    : [{ title: null, groups: shown }];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-headline text-xl font-bold">Check answers before the reveal</h2>
        <p className="text-sm text-muted tabular">
          {review.answered} answered · {review.changes} change{review.changes === 1 ? "" : "s"} · updates live
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">
        {isChoice
          ? "Mark a choice right or wrong to change the answer key for this question. It applies to every team that picked it."
          : isSequence
          ? "Identical answers are grouped. Part-right answers get their share of the points automatically; ✔ Right gives full points, ✘ Wrong gives none."
          : "Identical answers are grouped. Marking a group applies to every team that sent it, including teams that answer later."}{" "}
        Every change is saved in the competition log.
      </p>

      {!isChoice ? (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {([["all", "All"], ["wrong", "Not accepted"], ["right", "Accepted"], ["changed", "Changed by you"]] as const).map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cx("h-8 rounded-lg border px-3", filter === f ? "border-gold text-gold" : "border-line text-muted hover:text-white")}
            >
              {label} <span className="tabular opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
      ) : null}
      {review.voided_teams.length ? (
        <p className="mt-3 text-xs text-bad">Locked out by anti-cheat (answers don&apos;t count, not listed): {review.voided_teams.join(", ")}</p>
      ) : null}
      <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>

      {review.groups.length === 0 ? (
        <p className="mt-4 text-muted">No answers yet. They appear here as they arrive.</p>
      ) : (
        <div className="mt-3 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {sections.map((sec, si) => (
            <div key={si}>
              {sec.title ? <p className="mb-2 whitespace-pre-line text-sm font-semibold text-gold">{sec.title}</p> : null}
              {sec.groups.length === 0 ? (
                <p className="text-sm text-muted">Nothing here with this filter.</p>
              ) : (
                <ul className="space-y-2">
                  {sec.groups.map((g) => (
                    <Row key={g.key} g={g} busy={busy === g.key} disabled={!!busy} onMark={(v) => mark(g, v)} />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Row({ g, busy, disabled, onMark }: { g: ReviewGroup; busy: boolean; disabled: boolean; onMark: (v: Verdict | null) => void }) {
  const right = g.final === "CORRECT";
  // Ordering / matching: part-right, keeping its share of the points (until the host decides otherwise).
  const partial = !right && g.partial !== undefined && !g.override;
  return (
    <li
      className={cx(
        "flex flex-wrap items-center gap-3 rounded-xl border p-3",
        right ? "border-good/40 bg-good/5" : partial ? "border-partial/40 bg-partial/5" : "border-line bg-ink/40",
        g.override && "ring-1 ring-gold/60",
        g.count === 0 && "opacity-60",
      )}
    >
      <span
        className={cx("w-6 text-center text-lg font-bold", right ? "text-good" : partial ? "text-partial" : "text-bad")}
        aria-label={right ? "Counts as correct" : partial ? "Counts as partly right" : "Counts as wrong"}
      >
        {right ? "✔" : partial ? "½" : "✘"}
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words font-semibold">
          {g.label} <span className="text-sm font-normal text-muted tabular">× {g.count}</span>
          {g.typo && !g.override ? <span className="ml-2 rounded bg-gold/15 px-1.5 py-0.5 text-xs font-normal text-gold">typo accepted: check it</span> : null}
          {g.override ? <span className="ml-2 rounded bg-gold/15 px-1.5 py-0.5 text-xs font-normal text-gold">changed by you</span> : null}
        </p>
        {g.variants.length ? <p className="break-words text-xs text-muted">Also typed as: {g.variants.join(" · ")}</p> : null}
        <p className="text-xs text-muted">{g.override ? `Automatic marking: ${g.auto === "CORRECT" ? "correct" : g.partial !== undefined ? "partly right" : "wrong"} (${g.auto_note})` : g.auto_note}</p>
        {g.team_names.length ? <p className="truncate text-xs text-muted" title={g.team_names.join(", ")}>{g.team_names.join(", ")}</p> : null}
      </div>
      <div className="ml-auto flex shrink-0 gap-1.5">
        <button
          type="button"
          disabled={disabled || right}
          onClick={() => onMark("CORRECT")}
          className={cx("h-9 rounded-lg border px-3 text-sm font-semibold", right ? "border-good bg-good/20 text-good" : "border-line text-muted hover:border-good hover:text-good", disabled && !right && "opacity-50")}
        >
          ✔ Right
        </button>
        <button
          type="button"
          disabled={disabled || (!right && !partial)}
          onClick={() => onMark("WRONG")}
          className={cx(
            "h-9 rounded-lg border px-3 text-sm font-semibold",
            !right && !partial ? "border-bad bg-bad/20 text-bad" : "border-line text-muted hover:border-bad hover:text-bad",
            disabled && (right || partial) && "opacity-50",
          )}
        >
          ✘ Wrong
        </button>
        {g.override ? (
          <button type="button" disabled={disabled} onClick={() => onMark(null)} className="h-9 rounded-lg px-2 text-sm text-muted hover:text-white" title="Back to automatic marking">
            {busy ? "…" : "↺ Undo"}
          </button>
        ) : busy ? (
          <span className="grid h-9 place-items-center px-2 text-sm text-muted">…</span>
        ) : null}
      </div>
    </li>
  );
}
