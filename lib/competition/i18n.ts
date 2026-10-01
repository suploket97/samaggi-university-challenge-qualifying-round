/**
 * Printed reports and forms come in ONE language at a time, Thai or English,
 * so labels and filled-in details never mix. English reuses the wording in
 * format.ts; this file adds the Thai wording for everything a printout shows.
 * Team names, answers, question text and pack titles stay as entered.
 */
import type { BankQuestion, QuestionType, RoomSettings, ScoreRow } from "@/lib/game/types";
import { QUESTION_TYPE_LABEL } from "@/lib/game/types";
import type { TextMatch } from "@/lib/game/scoring";
import type { AnswerRecord, CompetitionDetail } from "./types";
import {
  SCORING_MODE_LABEL,
  VERDICT_LABEL,
  dateLong,
  markingNote,
  matchLabel,
  orderLabel,
  seconds,
  tieBreakNote,
  timeline,
  type SendOrder,
  type TimelineItem,
  type Verdict,
} from "./format";

export type Lang = "th" | "en";

/** Pick the string for the language. */
export const pick = (lang: Lang, th: string, en: string) => (lang === "th" ? th : en);

const TYPE_TH: Record<QuestionType, string> = {
  MCQ_SINGLE: "ตัวเลือกเดียว",
  MCQ_MULTI: "หลายคำตอบ",
  TRUE_FALSE: "ถูกหรือผิด",
  TEXT_INPUT: "พิมพ์คำตอบ",
  SUB_QUESTIONS_TEXT: "ข้อย่อย",
  ORDERING: "เรียงลำดับ",
  MATCHING: "จับคู่",
};

export function typeLabel(t: QuestionType, lang: Lang): string {
  return lang === "th" ? TYPE_TH[t] : QUESTION_TYPE_LABEL[t];
}

type Mode = NonNullable<RoomSettings["scoring_mode"]>;
const MODE_TH: Record<Mode, string> = {
  CLASSIC: "คลาสสิก: คะแนนข้อถูก + โบนัสความเร็ว",
  ACCURACY: "ความแม่นยำ: ได้คะแนนเต็มเมื่อส่งทันเวลา ไม่มีโบนัสความเร็ว",
  DECAY: "ลดตามเวลา: คะแนนลดจาก 100% (ตอบทันที) เหลือ 50% (หมดเวลา)",
};

export function modeLabel(m: Mode | undefined | null, lang: Lang): string {
  const k = m ?? "CLASSIC";
  return lang === "th" ? MODE_TH[k] : SCORING_MODE_LABEL[k];
}

export function dateL(t: string | number | null | undefined, lang: Lang): string {
  if (lang === "en") return dateLong(t);
  if (!t) return "–";
  return new Date(t).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** 3.4 วินาที / 1 นาที 05 วินาที */
export function secondsL(ms: number | null | undefined, lang: Lang): string {
  if (lang === "en") return seconds(ms);
  if (ms === null || ms === undefined) return "–";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} วินาที`;
  return `${Math.floor(s / 60)} นาที ${String(Math.round(s % 60)).padStart(2, "0")} วินาที`;
}

export function pointsL(n: number, lang: Lang): string {
  return lang === "th" ? `${n} คะแนน` : `${n} pts`;
}

const VERDICT_TH: Record<Verdict, string> = {
  CORRECT: "ถูก",
  PARTIAL: "ถูกบางส่วน",
  WRONG: "ผิด",
  NO_ANSWER: "ไม่ได้ตอบ",
  LOCKED_OUT: "ถูกล็อก (ออกจากหน้าจอ)",
};

export function verdictLabel(v: Verdict, lang: Lang): string {
  return lang === "th" ? VERDICT_TH[v] : VERDICT_LABEL[v];
}

export function orderLabelL(o: SendOrder | undefined | null, lang: Lang): string {
  if (lang === "en") return orderLabel(o);
  return o ? `ลำดับที่ ${o.pos} จาก ${o.of}` : "";
}

/** "(picture)" for a choice with no text. */
export function pictureL(lang: Lang): string {
  return lang === "th" ? "(รูปภาพ)" : "(picture)";
}

// ---------------------------------------------------------------------------
// Marking notes
// ---------------------------------------------------------------------------

function autoMatchTh(m: TextMatch): string {
  switch (m.kind) {
    case "EXACT":
      return "ตรงกับคำตอบที่ยอมรับ";
    case "NORMALISED":
      return `ยอมรับ: เหมือน “${m.matched}” เมื่อไม่นับตัวพิมพ์ เครื่องหมาย หรือช่องว่าง`;
    case "TYPO":
      return `ยอมรับโดยพิมพ์ผิด ${m.typos} ตัว (ตรงกับ “${m.matched}”)`;
    case "BLANK":
      return "เว้นว่าง";
    default:
      return "ไม่ตรงกับคำตอบที่ยอมรับ";
  }
}

export function matchLabelL(m: TextMatch | undefined, lang: Lang): string {
  if (lang === "en") return matchLabel(m);
  if (!m) return "";
  const base = autoMatchTh(m);
  if (m.override === "CORRECT") return `พิธีกรตัดสินให้ถูกระหว่างตรวจ (ระบบตรวจว่า: ${base})`;
  if (m.override === "WRONG") return `พิธีกรตัดสินให้ผิดระหว่างตรวจ (ระบบตรวจว่า: ${base})`;
  return base;
}

/** One-line explanation of how an answer was marked, in one language. */
export function markingNoteL(q: BankQuestion, a: AnswerRecord, lang: Lang): string {
  if (lang === "en") return markingNote(q, a);
  const note = baseNoteTh(q, a);
  const time = a.answered && !a.voided && a.time_factor !== undefined && a.fraction > 0 ? ` คะแนน ×${a.time_factor.toFixed(2)} เพราะตอบหลัง ${secondsL(a.elapsed_ms, "th")} (ลดตามเวลา)` : "";
  return note + time;
}

function baseNoteTh(q: BankQuestion, a: AnswerRecord): string {
  if (a.voided) {
    const f = a.flags.find((x) => x.kind === "FOCUS_LOST");
    return `ออกจากหน้าตอบคำถาม${f?.duration_ms ? ` ${secondsL(f.duration_ms, "th")}` : ""} ก่อนตอบ ข้อนี้จึงถูกล็อก`;
  }
  if (!a.answered) return "ไม่ได้ส่งคำตอบก่อนหมดเวลา";
  const m = a.marking;
  if (!m) return "";
  if (q.type === "TEXT_INPUT") return matchLabelL(m.text, "th");
  if (m.sequence) {
    const sq = m.sequence;
    const what = q.type === "MATCHING" ? "จับคู่ถูก" : "อยู่ถูกตำแหน่ง";
    const auto = sq.hits === sq.n ? "ถูกทั้งหมด" : `${what} ${sq.hits} จาก ${sq.n}`;
    if (sq.override === "CORRECT") return `พิธีกรตัดสินให้ถูกระหว่างตรวจ (ระบบตรวจว่า: ${auto})`;
    if (sq.override === "WRONG") return `พิธีกรตัดสินให้ผิดระหว่างตรวจ (ระบบตรวจว่า: ${auto})`;
    if (sq.hits === sq.n) return `${what}ทั้ง ${sq.n} รายการ`;
    return `${what} ${sq.hits} จาก ${sq.n}${a.fraction > 0 ? ` (คะแนนบางส่วน ${Math.round(a.fraction * 100)}%)` : q.multi_scoring === "ALL_OR_NOTHING" ? " (ต้องถูกทั้งหมดจึงได้คะแนน)" : ""}`;
  }
  if (q.type === "SUB_QUESTIONS_TEXT") return (m.parts ?? []).map((p, i) => `${i + 1}) ${p.correct ? `✔ +${p.points}` : "✘"} ${matchLabelL(p.match, "th")}`).join(" · ");
  const right = new Set(m.correct_ids ?? []);
  const picked = m.picked ?? [];
  const hits = picked.filter((c) => right.has(c)).length;
  const keyNote = m.original_ids ? ` พิธีกรเปลี่ยนเฉลยระหว่างตรวจ (เดิม ${m.original_ids.join(", ") || "ไม่มี"} ใหม่ ${[...right].join(", ") || "ไม่มี"})` : "";
  if (q.type === "MCQ_MULTI" && !a.correct) return `เลือก ${picked.length} ข้อ: ถูก ${hits} ผิด ${picked.length - hits} จากตัวเลือกที่ถูก ${right.size} ข้อ${a.fraction > 0 ? " (คะแนนบางส่วน)" : ""}${keyNote}`;
  return (a.correct ? "เลือกตัวเลือกที่ถูก" : `เลือก ${picked.join(", ")} คำตอบที่ถูก: ${[...right].join(", ")}`) + keyNote;
}

// ---------------------------------------------------------------------------
// Tie-break notes
// ---------------------------------------------------------------------------

/** Why this team sits above the next one on the same score, in one language. */
export function tieNoteL(rows: ScoreRow[], i: number, lang: Lang): string {
  if (lang === "en") return tieBreakNote(rows, i) ?? "";
  const r = rows[i];
  const below = rows[i + 1];
  if (!below || below.score !== r.score) return "";
  const s = (ms: number) => (ms / 1000).toFixed(1);
  if (below.rank === r.rank) return "เท่ากับทีมถัดไปทั้งคะแนน ข้อที่ถูก และเวลา";
  if (r.correct_count !== below.correct_count) return `นำ ${below.name} ด้วยจำนวนข้อที่ถูก (${r.correct_count} ต่อ ${below.correct_count})`;
  if (r.total_correct_time_ms !== below.total_correct_time_ms) return `นำ ${below.name} ด้วยเวลารวมข้อที่ถูก (${s(r.total_correct_time_ms)} ต่อ ${s(below.total_correct_time_ms)} วินาที)`;
  return `นำ ${below.name} เพราะเข้าห้องก่อน`;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const yes = (v: unknown) => v === "CORRECT";

const EVENT_TH: Record<string, (x: Record<string, unknown>) => string> = {
  PACK_SELECTED: (x) => `โหลดชุดคำถาม (${x.questions ?? "?"} ข้อ)`,
  QUESTION_STARTED: (x) => `เปิดคำถาม · ${x.time_limit_sec} วินาที${x.time_override ? " (พิธีกรตั้งเวลาเฉพาะข้อนี้)" : ""}`,
  TIME_ADJUSTED: (x) => `พิธีกร${Number(x.delta_sec) > 0 ? "เพิ่ม" : "ลด"}เวลา ${Math.abs(Number(x.delta_sec))} วินาที`,
  ANSWERS_LOCKED_BY_HOST: () => "พิธีกรปิดรับคำตอบก่อนหมดเวลา",
  TIME_UP: () => "หมดเวลา ปิดรับคำตอบ",
  ANSWER_REVEALED: (x) =>
    `เฉลยคำตอบ${x.answered !== undefined ? ` · ถูก ${x.correct} จาก ${x.answered} ทีมที่ตอบ` : ""}${Number(x.marking_changes) > 0 ? ` · ใช้การแก้การตรวจของพิธีกร ${x.marking_changes} รายการ` : ""}`,
  LEADERBOARD_SHOWN: () => "แสดงกระดานคะแนน",
  TIE_BREAK_SHOWN: (x) => {
    const by = x.decided_by === "CORRECT" ? "ตัดสินด้วยจำนวนข้อที่ถูก" : x.decided_by === "TIME" ? "ตัดสินด้วยเวลารวมข้อที่ถูก" : "เท่ากันทั้งสามเกณฑ์ ผ่านทั้งหมด";
    const teams = Array.isArray(x.teams) ? (x.teams as { name: string; qualified: boolean }[]).map((t) => `${t.name}${t.qualified ? " ✓" : " ✗"}`).join(", ") : "";
    return `แสดงการตัดสินคะแนนเสมอที่เส้นตัด (${x.qualify_count} อันดับแรก ทีมที่ได้ ${x.score} คะแนนเท่ากัน ${by})${teams ? `: ${teams}` : ""}`;
  },
  QUALIFIED_TEAMS_SHOWN: (x) => `ประกาศทีมที่ผ่านการคัดเลือก (${x.qualify_count} อันดับแรก ผ่าน ${x.qualified} ทีมรวมทีมเสมอ)`,
  MARK_CHANGED: (x) => {
    const what = `${x.part !== null && x.part !== undefined ? `ส่วนที่ ${Number(x.part) + 1}: ` : ""}“${x.label}”`;
    const teams = Array.isArray(x.teams) ? ` (${x.teams.length} ทีม: ${x.teams.join(", ")})` : "";
    if (x.verdict === null) return `พิธีกรตรวจ: ${what} กลับไปใช้การตรวจอัตโนมัติ (${yes(x.auto) ? "ถูก" : "ผิด"})${teams}`;
    return `พิธีกรตรวจ: ${what} ให้${yes(x.verdict) ? "ถูก" : "ผิด"} ระบบตรวจว่า${yes(x.auto) ? "ถูก" : "ผิด"}${teams}`;
  },
  MARK_CORRECTED: (x) => {
    const what = `${x.part !== null && x.part !== undefined ? `ส่วนที่ ${Number(x.part) + 1}: ` : ""}“${x.label}”`;
    const verdict = x.verdict === null ? `กลับไปใช้การตรวจอัตโนมัติ (${yes(x.auto) ? "ถูก" : "ผิด"})` : `ให้${yes(x.verdict) ? "ถูก" : "ผิด"}`;
    const ch = Array.isArray(x.changes) ? (x.changes as { name: string; before: number; after: number }[]) : [];
    const moved = ch.length ? ` · คะแนนเปลี่ยน: ${ch.map((c) => `${c.name} ${c.before}→${c.after}`).join(", ")}` : " · ไม่มีคะแนนเปลี่ยน";
    return `แก้ผลหลังเฉลย: ${what} ${verdict}${moved}`;
  },
  TEAM_RENAMED: (x) => `พิธีกรแก้ชื่อทีม “${x.from}” เป็น “${x.to}”`,
  TEAM_REMOVED: (x) => `พิธีกรลบทีม “${x.name}” (มี ${x.score} คะแนนขณะนั้น)`,
  DEVICE_MOVE_STARTED: (x) => `พิธีกรออกรหัสย้ายเครื่องให้ “${x.name}”`,
  DEVICE_MOVED: (x) => `“${x.name}” ย้ายไปอุปกรณ์ใหม่ (เครื่องเดิมถูกออกจากระบบ)`,
  MEDIA_CONTROL: (x) => `พิธีกร${x.action === "PLAY" ? "เล่น" : x.action === "PAUSE" ? "หยุด" : "เริ่มใหม่"}เสียง/วิดีโอบนจอใหญ่`,
  GAME_ENDED: () => "จบเกม",
  ROOM_DELETED: () => "ลบห้อง",
};

/** The timeline in one language. */
export function timelineL(d: CompetitionDetail, lang: Lang): TimelineItem[] {
  if (lang === "en") return timeline(d);
  return timeline(d).map((t) => {
    if (t.kind === "TEAM_JOINED") return { ...t, text: "เข้าห้อง" };
    const team = (d.competition.teams ?? []).find((x) => x.name === t.team);
    const flag = team?.flags.find((f) => f.kind === t.kind && f.at === t.at);
    if (flag) {
      const s = secondsL(flag.duration_ms ?? 0, "th");
      return {
        ...t,
        text: flag.kind === "PASTE_ATTEMPT" ? "พยายามวางข้อความในช่องคำตอบ (ถูกบล็อก)" : flag.kind === "WINDOW_BLUR" ? `มีหน้าต่างอื่นบังหน้าตอบคำถาม ${s} (คอมพิวเตอร์ ติดธงอย่างเดียว)` : `ออกจากหน้าตอบคำถาม ${s}`,
      };
    }
    const e = d.events.find((x) => x.kind === t.kind && x.at === t.at);
    const f = EVENT_TH[t.kind];
    return { ...t, text: f ? f(e?.detail ?? {}) : t.text };
  });
}
