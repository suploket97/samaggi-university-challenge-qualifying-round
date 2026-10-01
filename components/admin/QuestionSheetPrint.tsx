"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { CHOICE_LETTERS, type BankQuestion } from "@/lib/game/types";
import { displayOrder } from "@/lib/game/sequence";
import { subQuestionPoints } from "@/lib/game/scoring";
import { clock } from "@/lib/competition/format";
import { dateL, pick, pictureL, typeLabel } from "@/lib/competition/i18n";
import { Field, FormFoot, FormHead, Toolbar, useFormLang } from "./formkit";

interface PackRow {
  quiz_pack_id: string;
  title: string;
  description: string | null;
  default_time_limit_sec: number;
  default_base_points?: number;
}

/**
 * Printable question sheet in the same layout as the official forms, in one
 * language at a time: Q1 with answers for the host and judges, or Q2 questions
 * only as the teams' paper backup (with boxes for the team name and number).
 */
export function QuestionSheetPrint({ packId, answers }: { packId: string; answers: boolean }) {
  const [pack, setPack] = useState<PackRow | null>(null);
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt] = useState(() => Date.now());
  const [lang, setLang] = useFormLang();
  const T = (th: string, en: string) => pick(lang, th, en);
  const pic = pictureL(lang);

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
  const code = answers ? "Q1" : "Q2";
  const total = questions.reduce((n, q) => n + (q.base_points ?? base), 0);
  return (
    <div className="paper-page">
      <div className="paper form-doc">
        <Toolbar lang={lang} setLang={setLang}>
          <a href={`/admin/bank/print?pack=${encodeURIComponent(packId)}${answers ? "" : "&answers=1"}&lang=${lang}`}>
            {answers ? T("เปลี่ยนเป็นฉบับไม่มีเฉลย", "Switch to questions only") : T("เปลี่ยนเป็นฉบับมีเฉลย", "Switch to version with answers")}
          </a>
        </Toolbar>
        <section className="form-page flow">
        <FormHead
          code={code}
          title={answers ? T("ชุดคำถามพร้อมเฉลย", "Question sheet with answers") : T("ชุดคำถาม (สำรองกรณีระบบล่ม)", "Question sheet (paper backup)")}
          sub={answers ? T("สำหรับพิธีกรและกรรมการ ห้ามให้ทีมเห็น", "For the host and judges. Keep this away from the teams.") : T("รอบคัดเลือก", "Qualifying round")}
          lang={lang}
        />
        <div className="fgrid g4">
          <Field label={T("ชุดคำถาม", "Question pack")} v={pack.title} />
          <Field label={T("จำนวนข้อ", "Questions")} v={String(questions.length)} />
          <Field label={T("เวลาเริ่มต้นต่อข้อ", "Default time per question")} v={T(`${pack.default_time_limit_sec} วินาที`, `${pack.default_time_limit_sec} s`)} />
          {answers ? (
            <Field label={T("คะแนนเต็ม", "Total points")} v={String(total)} />
          ) : (
            <Field label={T("พิมพ์เมื่อ", "Printed")} v={`${dateL(printedAt, lang)} · ${clock(printedAt)}`} />
          )}
        </div>
        {answers ? null : (
          <div className="fgrid g3">
            <Field label={T("เลขทีม", "Team No.")} v="" tall />
            <Field label={T("ชื่อทีม", "Team name")} v="" tall />
            <Field label={T("หัวหน้าทีม (ลงนาม)", "Captain (signature)")} v="" tall />
          </div>
        )}
        {answers ? null : (
          <p className="fnote">
            {T(
              "เขียนคำตอบลงบนใบนี้ ตัวเลือกให้วงกลมตัวอักษร ข้อเรียงลำดับให้ใส่ตัวเลข 1, 2, 3… ในช่อง ส่งใบคืนกรรมการเมื่อหมดเวลาแต่ละข้อ",
              "Write your answers on this sheet. Circle the letter for choice questions; number the boxes 1, 2, 3… for ordering. Hand the sheet to a judge when told.",
            )}
          </p>
        )}
        {pack.description ? <p className="muted">{pack.description}</p> : null}

        <div style={{ marginTop: 16 }}>
          {questions.map((q, i) => {
            const pts = q.base_points ?? base;
            const subPts = q.type === "SUB_QUESTIONS_TEXT" ? subQuestionPoints(q, pts) : [];
            return (
              <div key={q.question_id} className="qblock">
                <div className="small muted">
                  <b style={{ color: "#111", fontSize: 14 }}>{i + 1}.</b>&nbsp; {typeLabel(q.type, lang)} · {T(`${q.time_limit_sec ?? pack.default_time_limit_sec} วินาที`, `${q.time_limit_sec ?? pack.default_time_limit_sec} s`)}
                  {answers ? T(` · ${pts} คะแนน`, ` · ${pts} pts`) : ""}
                </div>
                <div className="q-text" style={{ fontSize: 15, marginTop: 2 }}>{q.question_text}</div>
                {q.media_url && (q.media_type ?? "image") === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={q.media_url} alt="" />
                ) : q.media_url ? (
                  <div className="small muted">[{q.media_type === "audio" ? T("คลิปเสียง", "audio clip") : T("คลิปวิดีโอ", "video clip")}]</div>
                ) : null}
                {q.type === "ORDERING" ? (
                  answers ? (
                    <ol className="ans" style={{ margin: "6px 0 0", paddingLeft: 22 }}>
                      {(q.choices ?? []).map((c) => <li key={c.choice_id}>{c.text || pic}</li>)}
                    </ol>
                  ) : (
                    // Shuffled for the paper copy (never in the correct order), with a box to number each item.
                    <div style={{ marginTop: 6 }}>
                      {displayOrder(q.choices?.length ?? 0, "print", q.question_id).map((own) => (
                        <div key={own}>☐&nbsp; {q.choices![own].text || pic}</div>
                      ))}
                      <div className="small muted">{T("ใส่ตัวเลข 1, 2, 3… ในช่องตามลำดับ", "Number the boxes 1, 2, 3… in order.")}</div>
                    </div>
                  )
                ) : q.type === "MATCHING" ? (
                  answers ? (
                    <div className="ans" style={{ marginTop: 6 }}>
                      {(q.pairs ?? []).map((p, j) => <div key={j}>{j + 1}. {p.left} → {p.right}</div>)}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 24px", marginTop: 6 }}>
                      <div>{(q.pairs ?? []).map((p, j) => <div key={j}>{j + 1}. {p.left} &nbsp;<span className="blank" style={{ width: 40, minWidth: 40 }} /></div>)}</div>
                      <div>
                        {displayOrder(q.pairs?.length ?? 0, "print", q.question_id).map((own, j) => (
                          <div key={own}>{CHOICE_LETTERS[j]}) {q.pairs![own].right}</div>
                        ))}
                      </div>
                    </div>
                  )
                ) : q.choices?.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: q.choices.length > 4 ? "1fr 1fr" : "1fr", gap: "2px 24px", marginTop: 6 }}>
                    {q.choices.map((c) => {
                      const right = answers && q.correct_answers_array.includes(c.choice_id);
                      return (
                        <div key={c.choice_id} className={right ? "ok" : undefined}>
                          {c.choice_id}) {c.text || pic} {right ? "✔" : ""}
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
                          <span className="ans"> → {sq.correct_answers_array.join(" / ")} <span className="muted small">({T(`${subPts[j]} คะแนน`, `${subPts[j]} pts`)})</span></span>
                        ) : (
                          <div><span className="blank" /></div>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {q.type === "TEXT_INPUT" ? (
                  answers ? <div className="ans">{T("คำตอบที่ยอมรับ", "Accepted")}: {q.correct_answers_array.join(" / ")}{q.text_matching?.fuzzy === false ? T(" (ต้องสะกดตรงเท่านั้น)", " (exact spelling only)") : ""}</div> : <div style={{ marginTop: 8 }}><span className="blank" /></div>
                ) : null}
                {(q.type === "ORDERING" || q.type === "MATCHING") && answers ? (
                  <div className="small muted">{q.multi_scoring === "ALL_OR_NOTHING" ? T("ได้คะแนนเมื่อถูกทั้งหมดเท่านั้น", "Points only if everything is right") : T("ได้คะแนนบางส่วนตามจำนวนที่ถูก", "Partial credit for each item in the right place")}</div>
                ) : null}
                {q.type === "MCQ_MULTI" && answers ? <div className="small muted">{q.multi_scoring === "ALL_OR_NOTHING" ? T("ได้คะแนนเมื่อเลือกถูกทั้งหมดเท่านั้น", "Points only if every pick is right") : T("ได้คะแนนบางส่วนตามข้อที่เลือกถูก", "Partial credit for each right pick")}</div> : null}
                {answers && q.explanation ? <div className="small muted" style={{ marginTop: 3 }}>💡 {q.explanation}</div> : null}
              </div>
            );
          })}
        </div>
        <FormFoot code={code} lang={lang} note={answers ? T("เอกสารลับสำหรับพิธีกรและกรรมการ", "Confidential: host and judges only") : undefined} />
        </section>
      </div>
    </div>
  );
}
