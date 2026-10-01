"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { CompetitionDetail } from "@/lib/competition/types";
import { OfficialRecord } from "./OfficialRecord";
import { acceptedText, answerText, clock, firstCorrect, qualifiedSet, sendOrder, standings, teamSheet, verdict } from "@/lib/competition/format";
import { dateL, markingNoteL, modeLabel, orderLabelL, pick, secondsL, tieNoteL, timelineL, verdictLabel, type Lang } from "@/lib/competition/i18n";
import { Field, FormFoot, FormHead, Sigs, Th, Toolbar, useFormLang } from "./formkit";

export type PrintKind = "qualified" | "full" | "team" | "official" | "log";

/**
 * Print-ready reports in the same layout as the official forms, in one
 * language at a time (Thai or English). The browser's "Save as PDF" turns it
 * into a PDF, with Thai rendered correctly (the browser lays out the text).
 */
export function CompetitionPrint({ id, kind, teamId }: { id: string; kind: PrintKind; teamId?: string | null }) {
  const [d, setD] = useState<CompetitionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt] = useState(() => Date.now());
  const [lang, setLang] = useFormLang();

  useEffect(() => {
    api<CompetitionDetail>(`/api/admin/competitions/${encodeURIComponent(id)}`).then(setD).catch((e) => setError((e as ApiError).message));
  }, [id]);

  useEffect(() => {
    if (!d) return;
    const name = kind === "qualified" ? "Qualified teams" : kind === "team" ? "Team answers" : kind === "official" ? "Official record F1-F4" : kind === "log" ? "Full competition log" : "Competition report";
    document.title = `${name} – ${d.competition.pack_title ?? d.competition.room_code}`;
  }, [d, kind]);

  if (error) return <div className="paper-page"><div className="paper"><p className="bad">{error}</p></div></div>;
  if (!d) return <div className="paper-page"><div className="paper"><p className="muted">Loading…</p></div></div>;
  if (kind === "official") return <OfficialRecord d={d} />;

  const T = (th: string, en: string) => pick(lang, th, en);
  const c = d.competition;
  const rows = standings(d);
  const q = qualifiedSet(d);
  const team = teamId ? c.teams.find((t) => t.team_id === teamId) : null;
  const code = kind === "qualified" ? "R1" : kind === "full" ? "R2" : kind === "log" ? "R4" : "R3";
  const title =
    kind === "qualified" ? T("รายชื่อทีมที่ผ่านการคัดเลือก", "Qualified teams") : kind === "team"
        ? T(`ใบคำตอบของทีม: ${team?.name ?? ""}`, `Answer sheet: ${team?.name ?? "team"}`)
        : kind === "log"
          ? T("บันทึกการแข่งขันฉบับเต็ม", "Full competition log")
          : T("รายงานผลการแข่งขัน", "Competition report");

  return (
    <div className="paper-page">
      <div className="paper form-doc">
        <Toolbar lang={lang} setLang={setLang} />

        <section className={kind === "log" ? "form-page flow landscape" : "form-page flow"}>
          <FormHead code={code} title={title} sub={T("รอบคัดเลือก", "Qualifying round")} lang={lang} />
          <div className="fgrid g4">
            <Field label={T("วันที่", "Date")} v={`${dateL(c.created_at, lang)} · ${clock(c.created_at)}`} />
            <Field label={T("รหัสห้อง", "Room code")} v={<span className="code">{c.room_code}</span>} />
            <Field label={T("ชุดคำถาม", "Question pack")} v={c.pack_title ?? "—"} />
            <Field label={T("โหมดคะแนน", "Scoring mode")} v={modeLabel(c.settings?.scoring_mode, lang)} />
            <Field label={T("จำนวนทีม", "Teams")} v={String(c.teams.length)} />
            <Field label={T("จำนวนข้อที่เล่น", "Questions played")} v={`${c.questions_played} / ${c.question_total}`} />
            <Field label={T("พิมพ์เมื่อ", "Printed")} v={`${dateL(printedAt, lang)} · ${clock(printedAt)}`} />
            <Field
              label={T("สถานะ", "Status")}
              v={
                c.status === "LIVE" ? (
                  <span className="bad">{T("เกมยังไม่จบ ยังไม่ใช่ผลสุดท้าย", "Game still running: not final")}</span>
                ) : (
                  `${T("ผลสุดท้าย", "Final record")}${c.finished_at ? T(` จบเกม ${clock(c.finished_at)}`, `, ended ${clock(c.finished_at)}`) : ""}`
                )
              }
            />
          </div>

          {kind === "qualified" ? <Qualified /> : null}
          {kind === "team" && teamId ? <TeamAnswers d={d} teamId={teamId} lang={lang} /> : null}
          {kind === "full" ? (
            <>
              <p className="fst">{T("ตารางคะแนนสุดท้าย", "Final standings")}</p>
              <StandingsTable />
              <p className="fst page-break">{T("คำถาม", "Questions")}</p>
              <QuestionsTable />
              <p className="fst">{T("ธงกันโกงและการดำเนินการของพิธีกร", "Anti-cheat and host actions")}</p>
              <HostLog />
              <p className="tiny muted">
                {T("คำตอบรายทีมทั้งหมดอยู่ในไฟล์ Excel หรือพิมพ์ใบคำตอบของแต่ละทีมได้จาก Competition log", "Every team's individual answers are in the Excel download, or print one team's answer sheet from the Competition log.")}
              </p>
            </>
          ) : null}

          {kind === "log" ? (
            <>
              <p className="tiny muted">
                {T(
                  "ทุกอย่างที่ระบบบันทึกไว้ในเกมนี้: ตารางคะแนน สรุปรายข้อ คำตอบของทุกทีมในทุกข้อ และไทม์ไลน์เหตุการณ์ทั้งหมด ตรงกับไฟล์ Excel ของเกมเดียวกัน (ดูรหัสตรวจสอบท้ายหน้า)",
                  "Everything the system recorded for this game: standings, question summary, every team's answer to every question, and the complete timeline. It matches the Excel record of the same game (see the check code at the foot).",
                )}
              </p>
              <p className="fst">{T("1. ตารางคะแนนสุดท้าย", "1. Final standings")}</p>
              <StandingsTable />
              <p className="fst page-break">{T("2. สรุปรายข้อ", "2. Questions")}</p>
              <QuestionsTable />
              <p className="fst page-break">{T("3. คำตอบของทุกทีม", "3. Every team's answers")}</p>
              <AllAnswers />
              <p className="fst page-break">{T("4. ไทม์ไลน์ทั้งหมด", "4. Complete timeline")}</p>
              <FullTimeline />
            </>
          ) : null}

          {kind !== "team" ? <Sigs items={[T("ผู้ตรวจ", "Checked by"), T("หัวหน้ากรรมการ", "Chief judge")]} lang={lang} /> : null}
          <FormFoot code={code} lang={lang} check={d.fingerprint} />
        </section>
      </div>
    </div>
  );

  function QuestionsTable() {
    return (
    <table className="ftable">
      <thead>
        <tr>
          <Th label="#" w="5%" />
          <Th label={T("คำถาม", "Question")} w="34%" />
          <Th label={T("คำตอบที่ยอมรับ", "Accepted answers")} w="22%" />
          <Th label={T("ถูก/ตอบ", "Correct")} w="8%" />
          <Th label={T("เวลาและหมายเหตุ", "Timing and notes")} w="31%" />
        </tr>
      </thead>
      <tbody>
        {d!.questions.map((cq) => {
          const f = firstCorrect(cq);
          const notes = [
            `${clock(cq.started_at)}–${clock(cq.closed_at)} · ${secondsL(cq.effective.time_limit_sec * 1000, lang).replace(".0", "")}`,
            cq.closed_by === "HOST" ? T("พิธีกรปิดรับก่อนเวลา", "locked early by host") : "",
            cq.stats?.typo_accepted ? T(`ยอมรับคำพิมพ์ผิด ${cq.stats.typo_accepted} ทีม`, `${cq.stats.typo_accepted} accepted with typos`) : "",
            cq.stats?.overrides?.length
              ? T("พิธีกรตรวจ: ", "Host review: ") +
                cq.stats.overrides
                  .map((o) => `${o.part !== null ? T(`ส่วนที่ ${o.part + 1}: `, `part ${o.part + 1}: `) : ""}${o.label} → ${o.verdict === "CORRECT" ? T("ถูก", "correct") : T("ผิด", "wrong")}`)
                  .join("; ")
              : "",
            f ? T(`ตอบถูกคนแรก: ${f.names.join(", ")} (${secondsL(f.elapsed_ms, lang)})`, `First correct: ${f.names.join(", ")} (${secondsL(f.elapsed_ms, lang)})`) : "",
          ].filter(Boolean);
          return (
            <tr key={cq.question_index}>
              <td className="c">{cq.question_index + 1}</td>
              <td className="q-text">{cq.question.question_text}</td>
              <td className="tiny">{acceptedText(cq.question)}</td>
              <td className="c">{cq.stats ? `${cq.stats.correct}/${cq.stats.answered}` : "–"}</td>
              <td className="tiny">{notes.join(" · ")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    );
  }

  function AllAnswers() {
    return (
      <>
        {d!.questions.map((cq) => {
          const order = sendOrder(cq);
          const res = [...(cq.results ?? [])].sort((x, y) => (order.get(x.team_id)?.pos ?? 9999) - (order.get(y.team_id)?.pos ?? 9999) || x.team_name.localeCompare(y.team_name));
          return (
            <div key={cq.question_index} className="keep-head">
              <p className="fline" style={{ marginTop: 8 }}>
                <b>{T(`ข้อ ${cq.question_index + 1}`, `Q${cq.question_index + 1}`)}</b> · <span className="q-text">{cq.question.question_text}</span>
              </p>
              <p className="tiny ok" style={{ margin: "0 0 4px" }}>{T("คำตอบที่ยอมรับ", "Accepted")}: {acceptedText(cq.question)}</p>
              {res.length ? (
                <table className="ftable">
                  <thead>
                    <tr>
                      <Th label={T("ลำดับส่ง", "Order")} w="6%" />
                      <Th label={T("ทีม", "Team")} w="15%" />
                      <Th label={T("คำตอบ", "Answer")} w="19%" />
                      <Th label={T("ผล", "Result")} w="9%" />
                      <Th label={T("การตรวจ", "How it was marked")} w="25%" />
                      <Th label={T("คะแนน (โบนัส)", "Points (bonus)")} w="8%" />
                      <Th label={T("ส่งเมื่อ", "Sent")} w="10%" />
                      <Th label={T("ธง", "Flags")} w="8%" />
                    </tr>
                  </thead>
                  <tbody>
                    {res.map((a) => (
                      <tr key={a.team_id}>
                        <td className="c">{order.get(a.team_id)?.pos ?? "–"}</td>
                        <td>{a.team_name}</td>
                        <td className="q-text">{answerText(cq.question, a) || "—"}</td>
                        <td className="tiny"><b className={a.correct ? "ok" : verdict(a) === "PARTIAL" ? undefined : "bad"}>{verdictLabel(verdict(a), lang)}</b></td>
                        <td className="tiny">{markingNoteL(cq.question, a, lang)}</td>
                        <td className="c">{a.points}{a.speed_bonus ? ` (+${a.speed_bonus})` : ""}</td>
                        <td className="tiny c">{a.answered ? `${clock(a.received_at, true)} (+${secondsL(a.elapsed_ms, lang)})` : "–"}</td>
                        <td className="tiny">
                          {a.flags.map((f) =>
                            f.kind === "PASTE_ATTEMPT"
                              ? T("วางข้อความ", "paste")
                              : f.kind === "WINDOW_BLUR"
                                ? T(`หน้าต่างอื่น ${secondsL(f.duration_ms ?? 0, lang)}`, `other window ${secondsL(f.duration_ms ?? 0, lang)}`)
                                : T(`ออกจากจอ ${secondsL(f.duration_ms ?? 0, lang)}`, `left ${secondsL(f.duration_ms ?? 0, lang)}`),
                          ).join("; ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="tiny muted">{T("ไม่มีคำตอบ (ยังไม่ได้เฉลยข้อนี้)", "No answers recorded (this question wasn't revealed).")}</p>
              )}
            </div>
          );
        })}
      </>
    );
  }

  function FullTimeline() {
    const items = timelineL(d!, lang);
    return (
      <table className="ftable">
        <thead>
          <tr>
            <Th label={T("เวลา", "Time")} w="11%" />
            <Th label={T("ข้อ", "Q")} w="5%" />
            <Th label={T("ทีม", "Team")} w="18%" />
            <Th label={T("เหตุการณ์", "Event")} w="66%" />
          </tr>
        </thead>
        <tbody>
          {items.map((t, i) => (
            <tr key={i}>
              <td className="c">{clock(t.at, true)}</td>
              <td className="c">{t.question_index !== null ? t.question_index + 1 : ""}</td>
              <td>{t.team ?? ""}</td>
              <td className={t.warn ? "tiny bad" : "tiny"}>{t.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function Qualified() {
    if (!c.qualification) {
      return (
        <>
          <p className="bad">{T("เกมนี้ยังไม่ได้ประกาศทีมที่ผ่าน ตารางคะแนนปัจจุบัน:", "Qualification hasn't been revealed in this game yet. Current standings:")}</p>
          <StandingsTable />
        </>
      );
    }
    const through = rows.filter((r) => q.has(r.team_id));
    const tied = through.length > c.qualification.qualify_count;
    const rest = rows.filter((r) => !q.has(r.team_id)).slice(0, 5);
    return (
      <>
        <p className="fst">
          {T(`ผ่าน ${c.qualification.qualify_count} อันดับแรก`, `Top ${c.qualification.qualify_count} qualify`)}
          {tied ? <small>{T(` · ผ่าน ${through.length} ทีมเพราะมีทีมเสมอที่เส้นตัด`, ` · ${through.length} teams go through because of a tie at the cut`)}</small> : null}
        </p>
        <table className="ftable">
          <thead>
            <tr>
              <Th label={T("อันดับ", "Rank")} w="9%" />
              <Th label={T("เลขทีม", "Team No.")} w="10%" />
              <Th label={T("ชื่อทีม", "Team")} w="35%" />
              <Th label={T("คะแนน", "Score")} w="11%" />
              <Th label={T("ตอบถูก", "Correct")} w="10%" />
              <Th label={T("การตัดสินเสมอ", "Tie-break")} w="25%" />
            </tr>
          </thead>
          <tbody>
            {through.map((r) => (
              <tr key={r.team_id}>
                <td className="c">{r.rank}</td>
                <td />
                <td><b>{r.name}</b></td>
                <td className="c">{r.score}</td>
                <td className="c">{r.correct_count}</td>
                <td className="tiny">{tieNoteL(rows, rows.indexOf(r), lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rest.length ? (
          <p className="tiny muted">
            {T("อันดับถัดไป (ไม่ผ่าน)", "Next placed (did not qualify)")}: {rest.map((r) => `#${r.rank} ${r.name} (${r.score})`).join(", ")}
          </p>
        ) : null}
      </>
    );
  }

  function StandingsTable() {
    const hasQ = !!c.qualification;
    return (
      <table className="ftable">
        <thead>
          <tr>
            <Th label={T("อันดับ", "Rank")} w="7%" />
            <Th label={T("ชื่อทีม", "Team")} w="29%" />
            <Th label={T("คะแนน", "Score")} w="9%" />
            <Th label={T("ตอบถูก", "Correct")} w="8%" />
            <Th label={T("เวลาข้อที่ถูก", "Time on correct")} w="12%" />
            {hasQ ? <Th label={T("ผลคัดเลือก", "Qualified")} w="9%" /> : null}
            <Th label={T("หมายเหตุ", "Notes")} w={hasQ ? "26%" : "35%"} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const flags = c.teams.find((t) => t.team_id === r.team_id)?.flags.length ?? 0;
            const cut = hasQ && q.has(r.team_id) && !q.has(rows[i + 1]?.team_id ?? "");
            return (
              <tr key={r.team_id} className={cut ? "cut" : undefined}>
                <td className="c">{r.rank}</td>
                <td>{r.name}</td>
                <td className="c">{r.score}</td>
                <td className="c">{r.correct_count}</td>
                <td className="c">{secondsL(r.total_correct_time_ms, lang)}</td>
                {hasQ ? <td className="c">{q.has(r.team_id) ? T("ผ่าน", "Yes") : T("ไม่ผ่าน", "No")}</td> : null}
                <td className="tiny">{[flags ? T(`ธงกันโกง ${flags} ครั้ง`, `${flags} anti-cheat flag${flags > 1 ? "s" : ""}`) : "", tieNoteL(rows, i, lang)].filter(Boolean).join(" · ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  function HostLog() {
    const kinds = ["TIME_ADJUSTED", "ANSWERS_LOCKED_BY_HOST", "MARK_CHANGED", "MARK_CORRECTED", "TEAM_REMOVED", "TEAM_RENAMED", "DEVICE_MOVED", "TIE_BREAK_SHOWN", "QUALIFIED_TEAMS_SHOWN", "GAME_ENDED", "ROOM_DELETED"];
    const items = timelineL(d!, lang).filter((t) => t.warn || kinds.includes(t.kind));
    if (!items.length) return <p className="muted">{T("ไม่มีเหตุการณ์ผิดปกติ: ไม่มีธงกันโกง ไม่มีการปรับเวลา ไม่มีการแก้การตรวจ และไม่มีข้อที่ปิดรับก่อนเวลา", "Nothing unusual: no anti-cheat flags, no time changes, no marking changes and no questions locked early.")}</p>;
    return (
      <table className="ftable">
        <thead>
          <tr>
            <Th label={T("เวลา", "Time")} w="12%" />
            <Th label={T("ข้อ", "Q")} w="6%" />
            <Th label={T("ทีม", "Team")} w="22%" />
            <Th label={T("เหตุการณ์", "Event")} w="60%" />
          </tr>
        </thead>
        <tbody>
          {items.map((t, i) => (
            <tr key={i}>
              <td className="c">{clock(t.at, true)}</td>
              <td className="c">{t.question_index !== null ? t.question_index + 1 : ""}</td>
              <td>{t.team ?? ""}</td>
              <td className={t.warn ? "tiny bad" : "tiny"}>{t.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
}

function TeamAnswers({ d, teamId, lang }: { d: CompetitionDetail; teamId: string; lang: Lang }) {
  const T = (th: string, en: string) => pick(lang, th, en);
  const lines = teamSheet(d, teamId);
  const row = standings(d).find((r) => r.team_id === teamId);
  return (
    <>
      {row ? (
        <div className="fgrid g3">
          <Field label={T("อันดับ", "Rank")} v={String(row.rank)} />
          <Field label={T("คะแนน", "Score")} v={String(row.score)} />
          <Field label={T("ตอบถูก (ข้อ)", "Correct answers")} v={String(row.correct_count)} />
        </div>
      ) : null}
      <table className="ftable">
        <thead>
          <tr>
            <Th label={T("ข้อ", "Q")} w="5%" />
            <Th label={T("คำถาม / คำตอบที่ยอมรับ", "Question / accepted answers")} w="31%" />
            <Th label={T("คำตอบของทีม", "Team's answer")} w="18%" />
            <Th label={T("ผลและการตรวจ", "Result and marking")} w="26%" />
            <Th label={T("ส่งเมื่อ", "Sent")} w="13%" />
            <Th label={T("คะแนน", "Pts")} w="7%" />
          </tr>
        </thead>
        <tbody>
          {lines.map(({ q, a, order }) => (
            <tr key={q.question_index}>
              <td className="c">{q.question_index + 1}</td>
              <td>
                <div className="q-text">{q.question.question_text}</div>
                <div className="tiny ok">{acceptedText(q.question)}</div>
              </td>
              <td className="q-text">{a ? answerText(q.question, a) || "—" : "—"}</td>
              <td className="tiny">
                {a ? <b className={a.correct ? "ok" : verdict(a) === "PARTIAL" ? undefined : "bad"}>{verdictLabel(verdict(a), lang)}</b> : T("ไม่มีบันทึก", "Not recorded")}
                {a ? <div>{markingNoteL(q.question, a, lang)}</div> : null}
              </td>
              <td className="tiny c">
                {a?.answered ? `${clock(a.received_at)} (+${secondsL(a.elapsed_ms, lang)})` : "–"}
                {order ? <div>{orderLabelL(order, lang)}</div> : null}
              </td>
              <td className="c">{a?.points ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
