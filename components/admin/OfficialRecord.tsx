"use client";
import type { CompetitionDetail } from "@/lib/competition/types";
import type { ScoreRow } from "@/lib/game/types";
import { clock, qualifiedSet, standings } from "@/lib/competition/format";
import { dateL, modeLabel, tieNoteL, type Lang } from "@/lib/competition/i18n";
import { Ck, Field, FormFoot, FormHead, Sigs, Th, Toolbar, useFormLang } from "./formkit";

export type FormLang = Lang;

/**
 * The official paper record, filled in from the competition log: form F1
 * (qualifying result certificate), its Standings attachment, and form F4
 * (rulings and incidents log) with what the system recorded plus blank rows.
 * Same layout and fields as the printed forms F1–F4. Printed in ONE language
 * at a time (Thai or English): labels and filled-in details never mix.
 * Team names, room codes and pack titles are shown as entered.
 * Team numbers (T01…) come from registration, so those cells are left blank.
 */
export function OfficialRecord({ d }: { d: CompetitionDetail }) {
  const [lang, setLang] = useFormLang();

  const T = (th: string, en: string) => (lang === "th" ? th : en);
  const c = d.competition;
  const rows = standings(d);
  const q = qualifiedSet(d);
  const through = rows.filter((r) => q.has(r.team_id));
  const cut = cutInfo(rows, through, c.qualification?.qualify_count ?? null);
  const corrected = [...new Set(d.events.filter((e) => e.kind === "MARK_CORRECTED" && e.question_index !== null).map((e) => (e.question_index as number) + 1))].sort((a, b) => a - b);
  const incidents = f4Rows(d, lang);
  const live = c.status === "LIVE";
  const date = dateL(c.created_at, lang);
  const secs = (ms: number) => (ms / 1000).toFixed(1);

  return (
    <div className="paper-page">
      <div className="paper form-doc">
        <Toolbar lang={lang} setLang={setLang}>
          <span className="muted small">
            {T(
              "F1 พร้อมเอกสารแนบ และ F4 เติมจาก competition log พิมพ์แล้วลงนาม เลขทีมเขียนด้วยมือ",
              "F1 with its attachment, and F4, filled from the competition log. Print, then sign. Team numbers are written in by hand.",
            )}
          </span>
        </Toolbar>
        {live ? <p className="bad no-print">{T("เกมยังไม่จบ บันทึกนี้ยังไม่ใช่ผลสุดท้าย", "The game is still running: this record is not final.")}</p> : null}

        {/* ---------------- F1 ---------------- */}
        <section className="form-page">
          <FormHead code="F1" title={T("ใบรับรองผลรอบคัดเลือก", "Qualifying round result certificate")} lang={lang} badge={T("บันทึกทางการ", "Official record")} />
          <div className="fgrid g4">
            <Field label={T("วันที่", "Date")} v={date} />
            <Field label={T("รหัสห้อง", "Room code")} v={<span className="code">{c.room_code}</span>} />
            <Field label={T("ชุดคำถาม", "Question pack")} v={c.pack_title ?? "—"} />
            <Field label={T("โหมดคะแนน", "Scoring mode")} v={modeLabel(c.settings?.scoring_mode, lang)} />
            <Field label={T("จำนวนข้อที่เล่น", "Questions played")} v={`${c.questions_played} / ${c.question_total}`} />
            <Field label={T("จำนวนทีมที่เข้าร่วม", "Teams that played")} v={String(rows.length)} />
            <Field
              label={T("จำนวนทีมที่ผ่าน", "Qualifiers")}
              v={
                c.qualification
                  ? `${through.length}${through.length > c.qualification.qualify_count ? T(` (${c.qualification.qualify_count} อันดับแรก + ทีมเสมอ)`, ` (top ${c.qualification.qualify_count} + tie)`) : ""}`
                  : T("ยังไม่ได้ประกาศ", "Not revealed yet")
              }
            />
            <Field label={T("ไฟล์ Excel (ชื่อไฟล์/เวลาดาวน์โหลด)", "Excel record (file name/downloaded at)")} v="" />
          </div>

          <div className="fbox">
            <p className="fst">{T("ทีมที่ผ่านการคัดเลือก", "Qualified teams")} <small>· {T("จากแท็บ Standings", "from the Standings tab")}</small></p>
            <table className="ftable">
              <thead>
                <tr>
                  <Th label={T("อันดับ", "Rank")} w="8%" />
                  <Th label={T("เลขทีม", "Team No.")} w="10%" />
                  <Th label={T("ชื่อทีม", "Team")} w="30%" />
                  <Th label={T("คะแนน", "Score")} w="10%" />
                  <Th label={T("ตอบถูก (ข้อ)", "Correct answers")} w="10%" />
                  <Th label={T("เวลาข้อที่ถูก (วินาที)", "Time on correct (s)")} w="12%" />
                  <Th label={T("การตัดสินเสมอ", "Tie-break")} w="20%" />
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
                    <td className="c">{secs(r.total_correct_time_ms)}</td>
                    <td className="tiny">{tieNoteL(rows, rows.indexOf(r), lang)}</td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 4 - through.length) }, (_, i) => (
                  <tr key={`b${i}`}><td /><td /><td /><td /><td /><td /><td /></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="fgrid g2">
            <div className="fbox">
              <p className="fst">{T("เส้นตัด", "The cut")}</p>
              <p className="fline">
                {T("มีทีมคะแนนเท่ากันคร่อมเส้นตัด", "Teams level across the cut")}: <Ck on={cut.level === false}>{T("ไม่มี", "No")}</Ck> <Ck on={cut.level === true}>{T("มี", "Yes")}</Ck>
              </p>
              <p className="fline">
                {T("ตัดสินโดย", "Decided by")}: <Ck on={cut.by === "CORRECT"}>{T("จำนวนข้อที่ตอบถูก", "Correct answers")}</Ck> <Ck on={cut.by === "TIME"}>{T("เวลา", "Time")}</Ck>{" "}
                <Ck on={cut.by === "NONE"}>{T("ยังเสมอ ผ่านทั้งหมด (ข้อ 3.5)", "Still level, all through (3.5)")}</Ck>
              </p>
            </div>
            <div className="fbox">
              <p className="fst">{T("การประท้วงและการแก้ผล", "Challenges and corrections")}</p>
              <div className="fgrid g2">
                <Field label={T("จำนวนการประท้วงที่ยื่น", "Challenges lodged")} v="" />
                <Field
                  label={T("ข้อที่แก้ผลในระบบ", "Questions corrected")}
                  v={corrected.length ? corrected.map((n) => T(`ข้อ ${n}`, `Q${n}`)).join(", ") : T("ไม่มี", "None")}
                />
              </div>
              <p className="tiny muted" style={{ marginTop: 6 }}>{T("รายละเอียดใน F4 รายการที่", "Details on F4, entry nos")}: ____________</p>
            </div>
          </div>

          <p className="fnote">
            {T(
              "ใบนี้รับรองผลจาก competition log ของระบบตอบคำถาม และแนบตารางคะแนนทั้งหมด (หน้าถัดไป) หากผลในใบนี้ต่างจากระบบ ให้บันทึกเหตุผลใน F4",
              "This sheet certifies the quiz system's competition log; the full standings are attached (next page). If anything here differs from the system, record why on F4.",
            )}
          </p>
          <Sigs items={[T("พิธีกร", "Host"), T("หัวหน้ากรรมการ", "Chief judge"), T("กรรมการ", "Judge")]} lang={lang} />
          <FormFoot code="F1" lang={lang} check={d.fingerprint} />
        </section>

        {/* ---------------- F1 attachment: full standings ---------------- */}
        <section className="form-page">
          <FormHead code="F1" title={T("เอกสารแนบ: ตารางคะแนนทั้งหมด", "Attachment: full standings")} lang={lang} badge={T("บันทึกทางการ", "Official record")} />
          <table className="ftable">
            <thead>
              <tr>
                <Th label={T("อันดับ", "Rank")} w="7%" />
                <Th label={T("เลขทีม", "Team No.")} w="9%" />
                <Th label={T("ชื่อทีม", "Team")} w="26%" />
                <Th label={T("คะแนน", "Score")} w="9%" />
                <Th label={T("ตอบถูก", "Correct")} w="8%" />
                <Th label={T("เวลา (วินาที)", "Time (s)")} w="9%" />
                <Th label={T("ผลคัดเลือก", "Qualified")} w="9%" />
                <Th label={T("ธง", "Flags")} w="6%" />
                <Th label={T("การตัดสินเสมอ", "Tie-break")} w="17%" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const flags = c.teams.find((t) => t.team_id === r.team_id)?.flags.length ?? 0;
                const isCut = !!c.qualification && q.has(r.team_id) && !q.has(rows[i + 1]?.team_id ?? "");
                return (
                  <tr key={r.team_id} className={isCut ? "cut" : undefined}>
                    <td className="c">{r.rank}</td>
                    <td />
                    <td>{r.name}</td>
                    <td className="c">{r.score}</td>
                    <td className="c">{r.correct_count}</td>
                    <td className="c">{secs(r.total_correct_time_ms)}</td>
                    <td className="c">{c.qualification ? (q.has(r.team_id) ? T("ผ่าน", "Yes") : T("ไม่ผ่าน", "No")) : ""}</td>
                    <td className="c">{flags || ""}</td>
                    <td className="tiny">{tieNoteL(rows, i, lang)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="tiny muted" style={{ marginTop: 6 }}>{T("เส้นหนาอยู่ใต้ทีมสุดท้ายที่ผ่านการคัดเลือก", "The thick line marks the cut.")}</p>
          <FormFoot code="F1" lang={lang} check={d.fingerprint} />
        </section>

        {/* ---------------- F4 ---------------- */}
        <section className="form-page landscape">
          <FormHead code="F4" title={T("บันทึกคำตัดสินและเหตุการณ์", "Rulings and incidents log")} lang={lang} badge={T("บันทึกทางการ", "Official record")} />
          <div className="fgrid g4">
            <Field label={T("วันที่", "Date")} v={date} />
            <Field label={T("หัวหน้ากรรมการ", "Chief judge")} v="" />
            <Field label={T("แผ่นที่", "Sheet")} v="" />
            <Field label={T("รอบ", "Stage")} v={T("รอบคัดเลือก", "Qualifying")} />
          </div>
          <p className="fnote">
            {T(
              "รายการที่ระบบบันทึกไว้เติมให้แล้ว ให้เพิ่มการประท้วงที่ไม่ได้รับฟังและเหตุการณ์อื่นด้วยมือในแถวว่าง ผล: ",
              "Entries the system recorded are filled in; add rejected challenges and other incidents by hand. Outcome: ",
            )}
            <b>U</b> = {T("รับฟัง", "upheld")}, <b>R</b> = {T("ไม่รับฟัง", "rejected")}, <b>N</b> = {T("บันทึกไว้", "noted")}
          </p>
          <table className="ftable">
            <thead>
              <tr>
                <Th label={T("ลำดับ", "No.")} w="5%" />
                <Th label={T("เวลา", "Time")} w="7%" />
                <Th label={T("รอบ/รหัสนัด", "Round / Match ID")} w="9%" />
                <Th label={T("ข้อ", "Question")} w="5%" />
                <Th label={T("เลขทีม/ทีม", "Team No. / Team")} w="13%" />
                <Th label={T("ผู้ยื่น", "Raised by")} w="8%" />
                <Th label={T("เรื่องที่ประท้วง/เหตุการณ์", "Challenge or incident")} w="28%" />
                <Th label={T("ผล (U/R/N)", "U / R / N")} w="5%" />
                <Th label={T("การดำเนินการ (คะแนนเดิม→ใหม่)", "Action (score before→after)")} w="12%" />
                <Th label={T("กรรมการ (ลงชื่อย่อ)", "Judges (initials)")} w="8%" />
              </tr>
            </thead>
            <tbody>
              {incidents.map((r, i) => (
                <tr key={i}>
                  <td className="c">{i + 1}</td>
                  <td className="c">{clock(r.at)}</td>
                  <td>{T("รอบคัดเลือก", "Qualifying")}</td>
                  <td className="c">{r.question ?? ""}</td>
                  <td>{r.team}</td>
                  <td className="tiny">{r.raisedBy}</td>
                  <td className="tiny">{r.what}</td>
                  <td className="c"><b>{r.outcome}</b></td>
                  <td className="tiny">{r.action}</td>
                  <td />
                </tr>
              ))}
              {Array.from({ length: Math.max(6, 12 - incidents.length) }, (_, i) => (
                <tr key={`b${i}`}>
                  <td className="c">{incidents.length + i + 1}</td>
                  <td /><td /><td /><td /><td /><td /><td /><td /><td />
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fgrid g3" style={{ marginTop: 10 }}>
            <Field label={T("หัวหน้ากรรมการ (ลงนาม)", "Chief judge (signature)")} v="" tall />
            <Field label={T("กรรมการ (ลงนาม)", "Judge (signature)")} v="" tall />
            <Field label={T("เวลาปิดบันทึก", "Log closed at")} v="" tall />
          </div>
          <FormFoot code="F4" lang={lang} check={d.fingerprint} />
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Was the cut decided by a tie-break, and by what? Read from the final table. */
export function cutInfo(rows: ScoreRow[], through: ScoreRow[], qualifyCount: number | null): { level: boolean | null; by: "CORRECT" | "TIME" | "NONE" | null } {
  if (qualifyCount === null || !through.length) return { level: null, by: null };
  const last = through[through.length - 1];
  const next = rows.find((r) => !through.includes(r));
  if (through.length > qualifyCount) return { level: true, by: "NONE" };
  if (!next || next.score !== last.score) return { level: false, by: null };
  if (next.correct_count !== last.correct_count) return { level: true, by: "CORRECT" };
  if (next.total_correct_time_ms !== last.total_correct_time_ms) return { level: true, by: "TIME" };
  return { level: true, by: "NONE" };
}

export interface F4Row {
  at: string | number;
  question: number | null;
  team: string;
  raisedBy: string;
  what: string;
  outcome: "U" | "N";
  action: string;
}

/** The incidents F4 records, in one language: corrections after the reveal, team changes and anti-cheat flags. */
export function f4Rows(d: CompetitionDetail, lang: FormLang): F4Row[] {
  const th = lang === "th";
  const out: F4Row[] = [];
  const qn = (i: number | null) => (i === null ? null : i + 1);
  for (const e of d.events) {
    const x = (e.detail ?? {}) as Record<string, unknown>;
    if (e.kind === "MARK_CORRECTED") {
      const ch = Array.isArray(x.changes) ? (x.changes as { name: string; before: number; after: number }[]) : [];
      const label = String(x.label ?? "");
      const part = x.part !== null && x.part !== undefined ? Number(x.part) + 1 : null;
      const what = th
        ? `แก้ผลหลังเฉลย: ${part ? `ส่วนที่ ${part} ` : ""}“${label}” ${x.verdict === "CORRECT" ? "ให้ถูก" : x.verdict === "WRONG" ? "ให้ผิด" : "กลับไปใช้การตรวจอัตโนมัติ"}`
        : `Correction after the reveal: ${part ? `part ${part} ` : ""}“${label}” ${x.verdict === "CORRECT" ? "accepted" : x.verdict === "WRONG" ? "rejected" : "back to automatic marking"}`;
      out.push({
        at: e.at,
        question: qn(e.question_index),
        team: ch.map((c) => c.name).join(", "),
        raisedBy: "",
        what,
        outcome: "U",
        action: ch.length ? ch.map((c) => `${c.before}→${c.after}`).join(", ") : th ? "ไม่มีคะแนนเปลี่ยน" : "No points changed",
      });
    } else if (e.kind === "TEAM_REMOVED") {
      out.push({ at: e.at, question: null, team: String(x.name ?? ""), raisedBy: th ? "พิธีกร" : "Host", what: th ? `ลบทีมออก (มี ${x.score ?? 0} คะแนนขณะนั้น)` : `Team removed (${x.score ?? 0} pts at the time)`, outcome: "N", action: "" });
    } else if (e.kind === "TEAM_RENAMED") {
      out.push({ at: e.at, question: null, team: String(x.to ?? ""), raisedBy: th ? "พิธีกร" : "Host", what: th ? `แก้ชื่อทีมจาก “${x.from}”` : `Team renamed from “${x.from}”`, outcome: "N", action: "" });
    } else if (e.kind === "DEVICE_MOVED") {
      out.push({ at: e.at, question: null, team: String(x.name ?? ""), raisedBy: th ? "พิธีกร" : "Host", what: th ? "ย้ายทีมไปอุปกรณ์ใหม่ (เครื่องเดิมถูกออกจากระบบ)" : "Team moved to a new device (the old one was signed out)", outcome: "N", action: "" });
    }
  }
  for (const t of d.competition.teams ?? []) {
    for (const f of t.flags ?? []) {
      const s = ((f.duration_ms ?? 0) / 1000).toFixed(1);
      const what =
        f.kind === "PASTE_ATTEMPT"
          ? th ? "พยายามวางข้อความในช่องคำตอบ (ถูกบล็อก)" : "Tried to paste into the answer box (blocked)"
          : f.kind === "WINDOW_BLUR"
            ? th ? `มีหน้าต่างอื่นบังหน้าตอบคำถาม ${s} วินาที (คอมพิวเตอร์ ติดธงอย่างเดียว)` : `Another window was in front of the quiz for ${s} s (computer; flag only)`
            : th ? `ออกจากหน้าตอบคำถาม ${s} วินาที` : `Left the quiz screen for ${s} s`;
      out.push({ at: f.at, question: qn(f.question_index), team: t.name, raisedBy: th ? "ระบบ" : "System", what, outcome: "N", action: "" });
    }
  }
  return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
