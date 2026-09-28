"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { BankQuestion } from "@/lib/game/types";
import { subQuestionPoints } from "@/lib/game/scoring";
import { dateLong, clock } from "@/lib/competition/format";

interface PackRow {
  quiz_pack_id: string;
  title: string;
  description: string | null;
  default_time_limit_sec: number;
  default_base_points?: number;
}

const TYPE_LABEL: Record<string, string> = { MCQ_SINGLE: "One answer", MCQ_MULTI: "Several answers", TEXT_INPUT: "Typed answer", SUB_QUESTIONS_TEXT: "Sub-questions" };

/** Printable question sheet: with answers for the host and judges, or questions only as a paper backup. */
export function QuestionSheetPrint({ packId, answers }: { packId: string; answers: boolean }) {
  const [pack, setPack] = useState<PackRow | null>(null);
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt] = useState(() => Date.now());

  useEffect(() => {
    Promise.all([
      api<{ packs: PackRow[] }>("/api/admin/packs"),
      api<{ questions: BankQuestion[] }>(`/api/admin/packs/${encodeURIComponent(packId)}`),
    ])
      .then(([p, q]) => {
        setPack(p.packs.find((x) => x.quiz_pack_id === packId) ?? { quiz_pack_id: packId, title: packId, description: null, default_time_limit_sec: 30 });
        setQuestions(q.questions);
      })
      .catch((e) => setError((e as ApiError).message));
  }, [packId]);

  useEffect(() => {
    if (pack) document.title = `${answers ? "Question sheet (answers)" : "Questions"} – ${pack.title}`;
  }, [pack, answers]);

  if (error) return <div className="paper-page"><div className="paper"><p className="bad">{error}</p></div></div>;
  if (!pack || !questions) return <div className="paper-page"><div className="paper"><p className="muted">Loading…</p></div></div>;

  const base = pack.default_base_points ?? 100;
  return (
    <div className="paper-page">
      <div className="paper">
        <div className="toolbar no-print">
          <button className="primary" onClick={() => window.print()}>🖨 Print / Save as PDF</button>
          <a href={`/admin/bank/print?pack=${encodeURIComponent(packId)}${answers ? "" : "&answers=1"}`}>{answers ? "Switch to questions only" : "Switch to version with answers"}</a>
        </div>
        <div className="muted small" style={{ letterSpacing: ".2em", textTransform: "uppercase", fontWeight: 700 }}>Samaggi University Challenge · Qualifying Round</div>
        <h1 style={{ marginTop: 6 }}>{pack.title}</h1>
        <div className="meta">
          <span><b>{answers ? "Host copy, with answers. Keep this away from the teams." : "Questions only"}</b></span>
          <span>{questions.length} questions · default {pack.default_time_limit_sec} s each</span>
          <span className="small">Printed {dateLong(printedAt)} {clock(printedAt)}</span>
        </div>
        {pack.description ? <p className="muted">{pack.description}</p> : null}

        <div style={{ marginTop: 16 }}>
          {questions.map((q, i) => {
            const pts = q.base_points ?? base;
            const subPts = q.type === "SUB_QUESTIONS_TEXT" ? subQuestionPoints(q, pts) : [];
            return (
              <div key={q.question_id} className="qblock">
                <div className="small muted">
                  <b style={{ color: "#111", fontSize: 14 }}>{i + 1}.</b>&nbsp; {TYPE_LABEL[q.type]} · {q.time_limit_sec ?? pack.default_time_limit_sec} s
                  {answers ? ` · ${pts} pts` : ""}
                </div>
                <div className="q-text" style={{ fontSize: 15, marginTop: 2 }}>{q.question_text}</div>
                {q.media_url && (q.media_type ?? "image") === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={q.media_url} alt="" />
                ) : q.media_url ? (
                  <div className="small muted">[{q.media_type} clip]</div>
                ) : null}
                {q.choices?.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: q.choices.length > 4 ? "1fr 1fr" : "1fr", gap: "2px 24px", marginTop: 6 }}>
                    {q.choices.map((c) => {
                      const right = answers && q.correct_answers_array.includes(c.choice_id);
                      return (
                        <div key={c.choice_id} className={right ? "ok" : undefined}>
                          {c.choice_id}) {c.text || "(picture)"} {right ? "✔" : ""}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {q.type === "SUB_QUESTIONS_TEXT" ? (
                  <ol style={{ margin: "6px 0 0", paddingLeft: 22 }}>
                    {(q.sub_questions ?? []).map((sq, j) => (
                      <li key={sq.sub_id} style={{ marginTop: 3 }}>
                        <span className="q-text">{sq.prompt}</span>
                        {answers ? (
                          <span className="ans"> → {sq.correct_answers_array.join(" / ")} <span className="muted small">({subPts[j]} pts)</span></span>
                        ) : (
                          <div><span className="blank" /></div>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {q.type === "TEXT_INPUT" ? (
                  answers ? <div className="ans">Accepted: {q.correct_answers_array.join(" / ")}{q.text_matching?.fuzzy === false ? " (exact spelling only)" : ""}</div> : <div style={{ marginTop: 8 }}><span className="blank" /></div>
                ) : null}
                {q.type === "MCQ_MULTI" && answers ? <div className="small muted">{q.multi_scoring === "ALL_OR_NOTHING" ? "Points only if every pick is right" : "Partial credit for each right pick"}</div> : null}
                {answers && q.explanation ? <div className="small muted" style={{ marginTop: 3 }}>💡 {q.explanation}</div> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
