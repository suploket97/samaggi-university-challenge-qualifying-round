"use client";
import type { CompetitionDetail } from "@/lib/competition/types";
import type { ScoreRow } from "@/lib/game/types";
import {
  SCORING_MODE_LABEL,
  clock,
  dateLong,
  qualifiedSet,
  standings,
  tieBreakNote,
  timeline,
  type TimelineItem,
} from "@/lib/competition/format";

/**
 * The official paper record, filled in from the competition log: form F1
 * (qualifying result certificate), its Standings attachment, and form F4
 * (rulings and incidents log) with what the system recorded plus blank rows.
 * Same layout and field names as the printed forms F1–F4, so the PDF can be
 * signed and filed with them. Team numbers (T01…) come from registration, so
 * those cells are left for the officials to write in.
 */
export function OfficialRecord({ d }: { d: CompetitionDetail }) {
  const c = d.competition;
  const rows = standings(d);
  const q = qualifiedSet(d);
  const through = rows.filter((r) => q.has(r.team_id));
  const cut = cutInfo(rows, through, c.qualification?.qualify_count ?? null);
  const corrected = [...new Set(d.events.filter((e) => e.kind === "MARK_CORRECTED" && e.question_index !== null).map((e) => (e.question_index as number) + 1))].sort((a, b) => a - b);
  const incidents = f4Rows(d);
  const live = c.status === "LIVE";

  return (
    <div className="paper-page">
      <div className="paper form-doc">
        <div className="toolbar no-print">
          <button className="primary" onClick={() => window.print()}>🖨 Print / Save as PDF</button>
          <span className="muted small">F1, its Standings attachment and F4, filled from the competition log. Print, then sign. Team numbers are written in by hand.</span>
        </div>
        {live ? <p className="bad no-print">The game is still running: this record is not final.</p> : null}

        {/* ---------------- F1 ---------------- */}
        <section className="form-page">
          <FormHead code="F1" th="ใบรับรองผลรอบคัดเลือก" en="Qualifying round result certificate" />
          <div className="fgrid g4">
            <Field th="วันที่" en="Date" v={dateLong(c.created_at)} />
            <Field th="รหัสห้อง" en="Room code" v={<span className="code">{c.room_code}</span>} />
            <Field th="ชุดคำถาม" en="Question pack" v={c.pack_title ?? "—"} />
            <Field th="โหมดคะแนน" en="Scoring mode" v={SCORING_MODE_LABEL[c.settings?.scoring_mode ?? "CLASSIC"]} />
            <Field th="จำนวนข้อที่เล่น" en="Questions played" v={`${c.questions_played} / ${c.question_total}`} />
            <Field th="จำนวนทีมที่เข้าร่วม" en="Teams that played" v={String(rows.length)} />
            <Field
              th="จำนวนทีมที่ผ่าน"
              en="Qualifiers"
              v={c.qualification ? `${through.length}${through.length > c.qualification.qualify_count ? ` (top ${c.qualification.qualify_count} + tie)` : ""}` : "Not revealed yet"}
            />
            <Field th="ไฟล์ Excel (ชื่อ/เวลาดาวน์โหลด)" en="Excel record (file/downloaded at)" v="" />
          </div>

          <div className="fbox">
            <p className="fst">ทีมที่ผ่านการคัดเลือก <small>· Qualified teams (จากแท็บ Standings · from the Standings tab)</small></p>
            <table className="ftable">
              <thead>
                <tr>
                  <Th th="อันดับ" en="Rank" w="8%" />
                  <Th th="เลขทีม" en="Team No." w="10%" />
                  <Th th="ชื่อทีม" en="Team" w="30%" />
                  <Th th="คะแนน" en="Score" w="10%" />
                  <Th th="ตอบถูก" en="Correct answers" w="10%" />
                  <Th th="เวลาข้อที่ถูก (วินาที)" en="Time on correct (s)" w="12%" />
                  <Th th="ตัดสินเสมอ" en="Tie-break" w="20%" />
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
                    <td className="c">{(r.total_correct_time_ms / 1000).toFixed(1)}</td>
                    <td className="tiny">{tieBreakNote(rows, rows.indexOf(r)) ?? ""}</td>
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
              <p className="fst">เส้นตัด <small>· The cut</small></p>
              <p className="fline">
                มีทีมเท่ากันคร่อมเส้นตัด · Teams level across the cut: <Ck on={cut.level === false}>ไม่มี · No</Ck> <Ck on={cut.level === true}>มี · Yes</Ck>
              </p>
              <p className="fline">
                ตัดสินโดย · Decided by: <Ck on={cut.by === "CORRECT"}>จำนวนข้อถูก · Correct answers</Ck> <Ck on={cut.by === "TIME"}>เวลา · Time</Ck>{" "}
                <Ck on={cut.by === "NONE"}>ยังเสมอ ผ่านทั้งหมด (3.5) · Still level, all through</Ck>
              </p>
            </div>
            <div className="fbox">
              <p className="fst">การประท้วงและการแก้ผล <small>· Challenges and corrections</small></p>
              <div className="fgrid g2">
                <Field th="จำนวนที่ยื่น" en="Challenges lodged" v="" />
                <Field th="ข้อที่แก้ในระบบ" en="Questions corrected" v={corrected.length ? corrected.map((n) => `Q${n}`).join(", ") : "None"} />
              </div>
              <p className="tiny muted" style={{ marginTop: 6 }}>รายละเอียดใน F4 · Details on F4, entry nos: ____________</p>
            </div>
          </div>

          <p className="fnote">
            ใบนี้รับรองผลจาก competition log ของระบบตอบคำถาม แนบผล Standings ทั้งหมด (หน้าถัดไป) หากผลในใบนี้ต่างจากระบบ ให้บันทึกเหตุผลใน F4 · This sheet certifies the quiz
            system&apos;s competition log; the full Standings are attached (next page). If anything here differs from the system, record why on F4.
          </p>
          <Sigs items={[["พิธีกร", "Host"], ["หัวหน้ากรรมการ", "Chief judge"], ["กรรมการ", "Judge"]]} />
          <FormFoot code="F1" d={d} />
        </section>

        {/* ---------------- F1 attachment: full standings ---------------- */}
        <section className="form-page">
          <FormHead code="F1" th="เอกสารแนบ: ตารางคะแนนทั้งหมด" en="Attachment: full standings" />
          <table className="ftable">
            <thead>
              <tr>
                <Th th="อันดับ" en="Rank" w="7%" />
                <Th th="เลขทีม" en="Team No." w="9%" />
                <Th th="ชื่อทีม" en="Team" w="26%" />
                <Th th="คะแนน" en="Score" w="9%" />
                <Th th="ตอบถูก" en="Correct" w="8%" />
                <Th th="เวลา (วินาที)" en="Time (s)" w="9%" />
                <Th th="ผ่าน" en="Qualified" w="8%" />
                <Th th="ธง" en="Flags" w="6%" />
                <Th th="ตัดสินเสมอ" en="Tie-break" w="18%" />
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
                    <td className="c">{(r.total_correct_time_ms / 1000).toFixed(1)}</td>
                    <td className="c">{c.qualification ? (q.has(r.team_id) ? "Yes" : "No") : ""}</td>
                    <td className="c">{flags || ""}</td>
                    <td className="tiny">{tieBreakNote(rows, i) ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="tiny muted" style={{ marginTop: 6 }}>เส้นหนาใต้ทีมสุดท้ายที่ผ่าน · The thick line marks the cut.</p>
          <FormFoot code="F1" d={d} />
        </section>

        {/* ---------------- F4 ---------------- */}
        <section className="form-page landscape">
          <FormHead code="F4" th="บันทึกคำตัดสินและเหตุการณ์" en="Rulings and incidents log" />
          <div className="fgrid g4">
            <Field th="วันที่" en="Date" v={dateLong(c.created_at)} />
            <Field th="หัวหน้ากรรมการ" en="Chief judge" v="" />
            <Field th="หน้า" en="Sheet" v="" />
            <Field th="รอบ" en="Stage" v="Qualifying · รอบคัดเลือก" />
          </div>
          <p className="fnote">
            รายการที่ระบบบันทึกไว้เติมให้แล้ว เพิ่มการประท้วงที่ไม่ได้รับฟังและเหตุการณ์อื่นด้วยมือในแถวว่าง · Entries the system recorded are filled in; add rejected challenges and other incidents by
            hand. ผล · Outcome: <b>U</b> = รับฟัง · upheld, <b>R</b> = ไม่รับฟัง · rejected, <b>N</b> = บันทึกไว้ · noted.
          </p>
          <table className="ftable">
            <thead>
              <tr>
                <Th th="ลำดับ" en="No." w="5%" />
                <Th th="เวลา" en="Time" w="7%" />
                <Th th="รอบ/รหัสนัด" en="Round / Match ID" w="9%" />
                <Th th="ข้อ" en="Question" w="5%" />
                <Th th="เลขทีม/ทีม" en="Team No. / Team" w="13%" />
                <Th th="ผู้ยื่น" en="Raised by" w="8%" />
                <Th th="เรื่องที่ประท้วง/เหตุ" en="Challenge or incident" w="28%" />
                <Th th="ผล" en="U / R / N" w="5%" />
                <Th th="การดำเนินการ" en="Action (score before→after)" w="12%" />
                <Th th="กรรมการ" en="Judges (initials)" w="8%" />
              </tr>
            </thead>
            <tbody>
              {incidents.map((r, i) => (
                <tr key={i}>
                  <td className="c">{i + 1}</td>
                  <td className="c">{clock(r.item.at)}</td>
                  <td>Qualifying</td>
                  <td className="c">{r.item.question_index !== null ? r.item.question_index + 1 : ""}</td>
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
            <Field th="หัวหน้ากรรมการ (ลงนาม)" en="Chief judge (signature)" v="" tall />
            <Field th="กรรมการ (ลงนาม)" en="Judge (signature)" v="" tall />
            <Field th="เวลาปิดบันทึก" en="Log closed at" v="" tall />
          </div>
          <FormFoot code="F4" d={d} />
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

interface F4Row {
  item: TimelineItem;
  team: string;
  raisedBy: string;
  what: string;
  outcome: "U" | "N";
  action: string;
}

/** The incidents F4 records: corrections after the reveal, team changes and anti-cheat flags. */
export function f4Rows(d: CompetitionDetail): F4Row[] {
  const evByAt = new Map(d.events.map((e) => [`${e.kind}|${e.at}`, e]));
  const out: F4Row[] = [];
  for (const t of timeline(d)) {
    const e = evByAt.get(`${t.kind}|${t.at}`);
    const x = (e?.detail ?? {}) as Record<string, unknown>;
    if (t.kind === "MARK_CORRECTED") {
      const ch = Array.isArray(x.changes) ? (x.changes as { name: string; before: number; after: number }[]) : [];
      out.push({
        item: t,
        team: ch.map((c) => c.name).join(", "),
        raisedBy: "",
        what: `Correction after the reveal: “${String(x.label ?? "")}” ${x.verdict === "CORRECT" ? "accepted" : x.verdict === "WRONG" ? "rejected" : "back to automatic marking"}`,
        outcome: "U",
        action: ch.length ? ch.map((c) => `${c.before}→${c.after}`).join(", ") : "No points changed",
      });
    } else if (t.kind === "TEAM_REMOVED" || t.kind === "TEAM_RENAMED" || t.kind === "DEVICE_MOVED") {
      out.push({ item: t, team: String(x.name ?? x.to ?? ""), raisedBy: "Host", what: t.text, outcome: "N", action: "" });
    } else if (t.warn && t.team) {
      // Anti-cheat flags (left the screen, other window, paste attempt).
      out.push({ item: t, team: t.team, raisedBy: "System", what: t.text, outcome: "N", action: "" });
    }
  }
  return out;
}

function FormHead({ code, th, en }: { code: string; th: string; en: string }) {
  return (
    <div className="fhead">
      <div>
        <div className="fbrand"><b>Samaggi</b> University Challenge</div>
        <h1 className="ftitle">{th}<small>{en}</small></h1>
      </div>
      <div style={{ textAlign: "right" }}>
        <span className="fcode">{code}</span>
        <div className="tiny muted" style={{ marginTop: 6 }}>บันทึกทางการ · Official record</div>
      </div>
    </div>
  );
}

function FormFoot({ code, d }: { code: string; d: CompetitionDetail }) {
  return (
    <div className="ffoot">
      <span>{code} · v2026-10 · พิมพ์จากระบบ · printed from the system · Check code <b className="code">{d.fingerprint}</b></span>
      <span>แก้ไขโดยขีดฆ่าและลงชื่อย่อ · Strike through and initial corrections</span>
    </div>
  );
}

function Field({ th, en, v, tall }: { th: string; en: string; v: React.ReactNode; tall?: boolean }) {
  return (
    <div className={tall ? "ffield tall" : "ffield"}>
      <span className="flabel">{th} · {en}</span>
      <div className="fval">{v}</div>
    </div>
  );
}

function Th({ th, en, w }: { th: string; en: string; w: string }) {
  return <th style={{ width: w }}>{th}<small>{en}</small></th>;
}

function Ck({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className="fck"><i className={on ? "on" : undefined}>{on ? "✓" : ""}</i>{children}</span>;
}

function Sigs({ items }: { items: [string, string][] }) {
  return (
    <div className="fgrid g3">
      {items.map(([th, en]) => (
        <Field key={en} th={`${th} (ลงนาม/เวลา)`} en={`${en} (signature/time)`} v="" tall />
      ))}
    </div>
  );
}
