"use client";
import { useEffect, useState } from "react";
import type { ReviewPayload } from "@/lib/game/review";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, ErrorNote, Spinner, cx } from "@/components/ui";
import { ReviewPanel, type ScoreChange } from "./ReviewPanel";

/**
 * Upholding a challenge after the reveal: pick a revealed question, mark an
 * answer right or wrong, and that question is re-scored for every team.
 * Possible between questions, until the tie-break or the qualified teams are shown.
 */
export function CorrectionCard({
  code, revealedCount, onChanged,
}: {
  code: string;
  /** Questions revealed so far (1 = only Q1). */
  revealedCount: number;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [qi, setQi] = useState(Math.max(0, revealedCount - 1));
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ label: string; changes: ScoreChange[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setApplied(null);
    api<{ review: ReviewPayload }>(`/api/admin/rooms/${code}/correct?question=${qi}`)
      .then((r) => !cancelled && setReview(r.review))
      .catch((e) => !cancelled && (setReview(null), setError((e as ApiError).message)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, qi, code]);

  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-semibold">Challenge upheld?</p>
          <p className="text-sm text-muted">Correct the marking of a question that was already revealed. Scores update straight away.</p>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>✏️ Correct a revealed question</Button>
      </Card>
    );
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-headline text-xl font-bold">Correct after the reveal</h2>
        <select
          className="h-9 rounded-lg border border-line bg-ink px-2 text-sm"
          value={qi}
          onChange={(e) => setQi(Number(e.target.value))}
          aria-label="Question"
        >
          {Array.from({ length: revealedCount }, (_, i) => (
            <option key={i} value={i}>Q{i + 1}</option>
          ))}
        </select>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
    </div>
  );

  return (
    <div className="space-y-3">
      {applied ? (
        <div className={cx("rounded-xl border p-3 text-sm", applied.changes.length ? "border-gold/50 bg-gold/10" : "border-line bg-panel")}>
          <b>Q{qi + 1} · “{applied.label}”:</b>{" "}
          {applied.changes.length
            ? applied.changes.map((c) => `${c.name} ${c.before} → ${c.after}`).join(" · ")
            : "no team's points changed."}
          {applied.changes.length ? " The leaderboard is updated." : null}
        </div>
      ) : null}
      {review ? (
        <ReviewPanel
          code={code}
          review={review}
          after
          header={header}
          onChange={setReview}
          onApplied={(changes, label) => {
            setApplied({ changes, label });
            onChanged();
          }}
        />
      ) : (
        <Card className="p-5">
          {header}
          {loading ? <Spinner className="mt-4" /> : null}
          <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
        </Card>
      )}
    </div>
  );
}
