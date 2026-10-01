/**
 * Turns a competition log into what people read: answer text, marking
 * explanations, tie-break notes, a timeline and spreadsheet rows. Pure
 * functions, shared by the log page, the printed report and the exports.
 */
import type { BankQuestion, RoomSettings, ScoreRow } from "@/lib/game/types";
import { describeSequence, describeSequenceKey } from "@/lib/game/sequence";
import type { MarkOverride, TextMatch } from "@/lib/game/scoring";
import type { AnswerRecord, CompetitionDetail, CompetitionQuestion, CompetitionTeam } from "./types";

type Row = Record<string, string | number>;

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 09:41:07 in the viewer's time zone. */
export function clock(t: string | number | null | undefined, withMs = false): string {
  if (t === null || t === undefined || t === "") return "–";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "–";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${withMs ? "." + pad(d.getMilliseconds(), 3) : ""}`;
}

export function dateLong(t: string | number | null | undefined): string {
  if (!t) return "–";
  const d = new Date(t);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** 3.4 s / 1 min 05 s */
export function seconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  // Non-breaking spaces keep "30 s" together when a column is narrow.
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}\u00a0s`;
  return `${Math.floor(s / 60)}\u00a0min ${pad(Math.round(s % 60))}\u00a0s`;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export function choiceLabel(q: BankQuestion, id: string): string {
  const c = q.choices?.find((x) => x.choice_id === id);
  if (!c) return id;
  return c.text ? `${id} · ${c.text}` : `${id} · (picture)`;
}

/** What the team sent, readable. */
export function answerText(q: BankQuestion, a: AnswerRecord): string {
  if (!a.answered || !a.answer) return "";
  if (q.type === "TEXT_INPUT") return a.answer[0] ?? "";
  if (q.type === "SUB_QUESTIONS_TEXT") return a.answer.map((x, i) => `${i + 1}) ${x || "—"}`).join(" · ");
  if (q.type === "ORDERING" || q.type === "MATCHING") return describeSequence(q, a.answer);
  return a.answer.map((id) => choiceLabel(q, id)).join(", ");
}

/** The accepted answers, readable. */
export function acceptedText(q: BankQuestion): string {
  if (q.type === "TEXT_INPUT") return q.correct_answers_array.join(" / ");
  if (q.type === "SUB_QUESTIONS_TEXT") return (q.sub_questions ?? []).map((s, i) => `${i + 1}) ${s.correct_answers_array.join(" / ")}`).join(" · ");
  if (q.type === "ORDERING" || q.type === "MATCHING") return describeSequenceKey(q);
  return q.correct_answers_array.map((id) => choiceLabel(q, id)).join(", ");
}

export function matchLabel(m: TextMatch | undefined): string {
  if (!m) return "";
  const base = autoMatchLabel(m);
  if (m.override === "CORRECT") return `Marked correct by the host during the review (automatic marking: ${lowerFirst(base)})`;
  if (m.override === "WRONG") return `Marked wrong by the host during the review (automatic marking: ${lowerFirst(base)})`;
  return base;
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

function autoMatchLabel(m: TextMatch): string {
  switch (m.kind) {
    case "EXACT":
      return "Exact match";
    case "NORMALISED":
      return `Accepted: same as “${m.matched}” ignoring capitals, accents, spaces or punctuation`;
    case "TYPO":
      return `Accepted with ${m.typos} typo${m.typos === 1 ? "" : "s"} (matched “${m.matched}”)`;
    case "BLANK":
      return "Left blank";
    default:
      return "No accepted answer matched";
  }
}

export type Verdict = "CORRECT" | "PARTIAL" | "WRONG" | "NO_ANSWER" | "LOCKED_OUT";

export function verdict(a: AnswerRecord): Verdict {
  if (a.voided) return "LOCKED_OUT";
  if (!a.answered) return "NO_ANSWER";
  if (a.correct) return "CORRECT";
  return a.fraction > 0 ? "PARTIAL" : "WRONG";
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  CORRECT: "Correct",
  PARTIAL: "Partly right",
  WRONG: "Wrong",
  NO_ANSWER: "No answer",
  LOCKED_OUT: "Locked out (left the screen)",
};

/** Scoring modes in words (chosen when the room was created). */
export const SCORING_MODE_LABEL: Record<NonNullable<RoomSettings["scoring_mode"]>, string> = {
  CLASSIC: "Classic: points for a right answer + speed bonus",
  ACCURACY: "Accuracy only: full points whenever the answer arrives in time, no speed bonus",
  DECAY: "Speed decay: points shrink from 100% (instant) to 50% (at the buzzer)",
};

/** DECAY scoring: "×0.83 for time", added to the marking note. */
function timeNote(a: AnswerRecord): string {
  return a.time_factor !== undefined && a.fraction > 0 ? ` Points ×${a.time_factor.toFixed(2)} for answering after ${seconds(a.elapsed_ms)} (speed decay).` : "";
}

/** One-line explanation of how an answer was marked. */
export function markingNote(q: BankQuestion, a: AnswerRecord): string {
  const note = baseMarkingNote(q, a);
  return a.answered && !a.voided ? note + timeNote(a) : note;
}

function baseMarkingNote(q: BankQuestion, a: AnswerRecord): string {
  if (a.voided) {
    const f = a.flags.find((x) => x.kind === "FOCUS_LOST");
    return `Left the quiz screen${f?.duration_ms ? ` for ${seconds(f.duration_ms)}` : ""} before answering, so this question was locked for the team.`;
  }
  if (!a.answered) return "Nothing was sent before answers closed.";
  const m = a.marking;
  if (!m) return "";
  if (q.type === "TEXT_INPUT") return matchLabel(m.text);
  if (m.sequence) {
    const sq = m.sequence;
    const what = q.type === "MATCHING" ? "matched correctly" : "in the right place";
    const auto = sq.hits === sq.n ? "all correct" : `${sq.hits} of ${sq.n} ${what}`;
    if (sq.override === "CORRECT") return `Marked correct by the host during the review (automatic marking: ${auto}).`;
    if (sq.override === "WRONG") return `Marked wrong by the host during the review (automatic marking: ${auto}).`;
    if (sq.hits === sq.n) return `All ${sq.n} ${what}.`;
    return `${sq.hits} of ${sq.n} ${what}${a.fraction > 0 ? ` (partial credit: ${Math.round(a.fraction * 100)}%)` : q.multi_scoring === "ALL_OR_NOTHING" ? " (all-or-nothing: no points)" : ""}.`;
  }
  if (q.type === "SUB_QUESTIONS_TEXT")
    return (m.parts ?? []).map((p, i) => `${i + 1}) ${p.correct ? `✔ +${p.points}` : "✘"} ${matchLabel(p.match)}`).join(" · ");
  const right = new Set(m.correct_ids ?? []);
  const picked = m.picked ?? [];
  const hits = picked.filter((c) => right.has(c)).length;
  const keyNote = m.original_ids ? ` The host changed the answer key during the review (was ${m.original_ids.join(", ") || "none"}, now ${[...right].join(", ") || "none"}).` : "";
  if (q.type === "MCQ_MULTI" && !a.correct)
    return `Picked ${picked.length}: ${hits} right, ${picked.length - hits} wrong, of ${right.size} correct choices${a.fraction > 0 ? " (partial credit)" : ""}.${keyNote}`;
  return (a.correct ? "Picked a correct choice." : `Picked ${picked.join(", ")}; correct: ${[...right].join(", ")}.`) + keyNote;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

/** Why this team is placed above the next one, when their scores are equal. */
export function tieBreakNote(rows: ScoreRow[], i: number): string | null {
  const r = rows[i];
  const below = rows[i + 1];
  if (!below || below.score !== r.score) return null;
  if (below.rank === r.rank) return "Tied with the next team on score, correct answers and time";
  if (r.correct_count !== below.correct_count) return `Ahead of ${below.name} on correct answers (${r.correct_count} vs ${below.correct_count})`;
  if (r.total_correct_time_ms !== below.total_correct_time_ms)
    return `Ahead of ${below.name} on time for correct answers (${seconds(r.total_correct_time_ms)} vs ${seconds(below.total_correct_time_ms)})`;
  return `Ahead of ${below.name} by joining first`;
}

export function qualifiedSet(d: CompetitionDetail): Set<string> {
  return new Set(d.competition.qualification?.qualified_team_ids ?? []);
}

/** Standings to show: the qualification's final table if shown, else the latest. */
export function standings(d: CompetitionDetail): ScoreRow[] {
  return d.competition.qualification?.final_standings ?? d.competition.standings ?? [];
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const EVENT_TEXT: Record<string, (x: Record<string, unknown>) => string> = {
  PACK_SELECTED: (x) => `Question pack loaded (${x.questions ?? "?"} questions)`,
  QUESTION_STARTED: (x) => `Question opened · ${x.time_limit_sec} s${x.time_override ? " (time set by the host for this question)" : ""}`,
  TIME_ADJUSTED: (x) => `Host ${Number(x.delta_sec) > 0 ? "added" : "removed"} ${Math.abs(Number(x.delta_sec))} s`,
  ANSWERS_LOCKED_BY_HOST: (x) => `Host locked answers early${x.was_due ? ` (time was due to run out at ${clock(x.was_due as string)})` : ""}`,
  TIME_UP: () => "Time ran out; answers closed",
  ANSWER_REVEALED: (x) =>
    `Answer revealed${x.answered !== undefined ? ` · ${x.correct} of ${x.answered} answering teams correct` : ""}${Number(x.marking_changes) > 0 ? ` · ${x.marking_changes} marking change${Number(x.marking_changes) === 1 ? "" : "s"} by the host applied` : ""}`,
  LEADERBOARD_SHOWN: () => "Leaderboard shown",
  TIE_BREAK_SHOWN: (x) => {
    const by = x.decided_by === "CORRECT" ? "decided by correct answers" : x.decided_by === "TIME" ? "decided by total time on correct answers" : "level on all three, all go through";
    const teams = Array.isArray(x.teams) ? (x.teams as { name: string; qualified: boolean }[]).map((t) => `${t.name}${t.qualified ? " ✓" : " ✗"}`).join(", ") : "";
    return `Tie-break shown at the cut (top ${x.qualify_count}; teams level on ${x.score} points, ${by})${teams ? `: ${teams}` : ""}`;
  },
  QUALIFIED_TEAMS_SHOWN: (x) => `Qualified teams revealed (top ${x.qualify_count}; ${x.qualified} through including ties)`,
  MARK_CHANGED: (x) => {
    const what = `${x.part !== null && x.part !== undefined ? `part ${Number(x.part) + 1}: ` : ""}“${x.label}”`;
    const teams = Array.isArray(x.teams) ? ` (${x.teams.length} team${x.teams.length === 1 ? "" : "s"} so far: ${x.teams.join(", ")})` : "";
    if (x.verdict === null) return `Host review: ${what} back to automatic marking (${x.auto === "CORRECT" ? "correct" : "wrong"})${teams}`;
    return `Host review: ${what} marked ${x.verdict === "CORRECT" ? "correct" : "wrong"}; automatic marking said ${x.auto === "CORRECT" ? "correct" : "wrong"}${teams}`;
  },
  MARK_CORRECTED: (x) => {
    const what = `${x.part !== null && x.part !== undefined ? `part ${Number(x.part) + 1}: ` : ""}“${x.label}”`;
    const verdict = x.verdict === null ? `back to automatic marking (${x.auto === "CORRECT" ? "correct" : "wrong"})` : `marked ${x.verdict === "CORRECT" ? "correct" : "wrong"}`;
    const ch = Array.isArray(x.changes) ? (x.changes as { name: string; before: number; after: number }[]) : [];
    const moved = ch.length ? ` · points changed: ${ch.map((c) => `${c.name} ${c.before}→${c.after}`).join(", ")}` : " · no points changed";
    return `Correction after the reveal: ${what} ${verdict}${moved}`;
  },
  TEAM_RENAMED: (x) => `Host renamed team “${x.from}” to “${x.to}”`,
  TEAM_REMOVED: (x) => `Host removed team “${x.name}” (${x.score} pts at the time)`,
  DEVICE_MOVE_STARTED: (x) => `Host issued a code to move “${x.name}” to a new device`,
  DEVICE_MOVED: (x) => `“${x.name}” moved to a new device (the old one was signed out)`,
  MEDIA_CONTROL: (x) => `Host ${x.action === "PLAY" ? "played" : x.action === "PAUSE" ? "paused" : "restarted"} the sound/video on the big screen`,
  GAME_ENDED: () => "Game ended",
  ROOM_DELETED: () => "Room deleted",
};

export interface TimelineItem {
  at: string | number;
  question_index: number | null;
  kind: string;
  text: string;
  team?: string;
  warn?: boolean;
}

export function timeline(d: CompetitionDetail): TimelineItem[] {
  const items: TimelineItem[] = d.events.map((e) => ({
    at: e.at,
    question_index: e.question_index,
    kind: e.kind,
    text: (EVENT_TEXT[e.kind] ?? (() => e.kind.replace(/_/g, " ").toLowerCase()))(e.detail ?? {}),
    ...(["MARK_CORRECTED", "TEAM_REMOVED", "DEVICE_MOVED"].includes(e.kind) ? { warn: true } : {}),
  }));
  for (const t of d.competition.teams ?? []) {
    items.push({ at: t.joined_at ?? d.competition.created_at, question_index: null, kind: "TEAM_JOINED", text: "Joined", team: t.name });
    for (const f of t.flags ?? []) {
      items.push({
        at: f.at,
        question_index: f.question_index,
        kind: f.kind,
        team: t.name,
        warn: true,
        text: f.kind === "PASTE_ATTEMPT" ? "Tried to paste into the answer box (blocked)" : f.kind === "WINDOW_BLUR" ? `Another window was in front of the quiz for ${seconds(f.duration_ms ?? 0)} (computer; flag only)` : `Left the quiz screen for ${seconds(f.duration_ms ?? 0)}`,
      });
    }
  }
  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

// ---------------------------------------------------------------------------
// One team's answer sheet
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Order answers arrived in
// ---------------------------------------------------------------------------

export interface SendOrder {
  /** 1 = first answer the server received for this question. */
  pos: number;
  /** How many teams sent an answer. */
  of: number;
}

/**
 * The order answers reached the server (its clock, not the phones'). Two
 * answers in the same millisecond share a place. Doesn't affect scoring:
 * the speed bonus and tie-breaks use time, not order.
 */
export function sendOrder(q: CompetitionQuestion): Map<string, SendOrder> {
  const sent = (q.results ?? [])
    .filter((a) => a.answered && a.received_at !== null)
    .sort((a, b) => a.received_at! - b.received_at! || a.team_name.localeCompare(b.team_name));
  const out = new Map<string, SendOrder>();
  let pos = 0;
  let last: number | null = null;
  sent.forEach((a, i) => {
    if (a.received_at !== last) {
      pos = i + 1;
      last = a.received_at;
    }
    out.set(a.team_id, { pos, of: sent.length });
  });
  return out;
}

export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "3rd of 11" */
export function orderLabel(o: SendOrder | undefined | null): string {
  return o ? `${ordinal(o.pos)} of ${o.of}` : "";
}

/** The first team to send a fully correct answer (ties on the same millisecond: all of them). */
export function firstCorrect(q: CompetitionQuestion): { names: string[]; elapsed_ms: number | null } | null {
  const right = (q.results ?? []).filter((a) => a.correct && a.received_at !== null);
  if (!right.length) return null;
  const t = Math.min(...right.map((a) => a.received_at!));
  const first = right.filter((a) => a.received_at === t);
  return { names: first.map((a) => a.team_name).sort(), elapsed_ms: first[0].elapsed_ms };
}

export interface SheetLine {
  q: CompetitionQuestion;
  a: AnswerRecord | null;
  order: SendOrder | null;
}

export function teamSheet(d: CompetitionDetail, teamId: string): SheetLine[] {
  return d.questions.map((q) => ({ q, a: q.results?.find((r) => r.team_id === teamId) ?? null, order: sendOrder(q).get(teamId) ?? null }));
}

export function teamById(d: CompetitionDetail): Map<string, CompetitionTeam> {
  return new Map((d.competition.teams ?? []).map((t) => [t.team_id, t]));
}

// ---------------------------------------------------------------------------
// Spreadsheet tabs (Excel) — the CSV download uses the "Answers" tab
// ---------------------------------------------------------------------------

export function standingsRows(d: CompetitionDetail): Row[] {
  const rows = standings(d);
  const q = qualifiedSet(d);
  const teams = teamById(d);
  return rows.map((r, i) => ({
    Rank: r.rank,
    Team: r.name,
    Score: r.score,
    "Correct answers": r.correct_count,
    "Time on correct answers (s)": Math.round(r.total_correct_time_ms / 100) / 10,
    Qualified: d.competition.qualification ? (q.has(r.team_id) ? "Yes" : "No") : "",
    "Anti-cheat flags": teams.get(r.team_id)?.flags.length ?? 0,
    "Tie-break": tieBreakNote(rows, i) ?? "",
  }));
}

export function answerRows(d: CompetitionDetail): Row[] {
  const out: Row[] = [];
  for (const cq of d.questions) {
    const order = sendOrder(cq);
    for (const a of cq.results ?? []) {
      out.push({
        Question: cq.question_index + 1,
        "Question text": cq.question.question_text,
        Team: a.team_name,
        Answer: answerText(cq.question, a),
        Result: VERDICT_LABEL[verdict(a)],
        "How it was marked": markingNote(cq.question, a),
        Points: a.points,
        "Speed bonus": a.speed_bonus,
        "Time factor": a.time_factor ?? "",
        "Received at": a.received_at ? clock(a.received_at, true) : "",
        "Seconds after start": a.elapsed_ms === null ? "" : Math.round(a.elapsed_ms / 100) / 10,
        "Order sent": order.get(a.team_id)?.pos ?? "",
        "Teams that answered": order.get(a.team_id)?.of ?? "",
        "Anti-cheat flags": a.flags.map((f) => (f.kind === "PASTE_ATTEMPT" ? "paste attempt" : f.kind === "WINDOW_BLUR" ? `other window ${seconds(f.duration_ms ?? 0)}` : `left ${seconds(f.duration_ms ?? 0)}`)).join("; "),
      });
    }
  }
  return out;
}

export function questionRows(d: CompetitionDetail): Row[] {
  return d.questions.map((cq) => {
    const s = cq.stats;
    const first = firstCorrect(cq);
    return {
      Question: cq.question_index + 1,
      Type: cq.question.type,
      "Question text": cq.question.question_text,
      "Accepted answers": acceptedText(cq.question),
      "Time limit (s)": cq.effective.time_limit_sec,
      Scoring: cq.effective.scoring_mode ?? "CLASSIC",
      Points: cq.effective.base_points,
      Opened: clock(cq.started_at),
      Closed: clock(cq.closed_at),
      "Closed by": cq.closed_by === "HOST" ? "Host (early)" : cq.closed_by === "TIMER" ? "Timer" : "",
      Revealed: clock(cq.revealed_at),
      Answered: s?.answered ?? "",
      Correct: s?.correct ?? "",
      "% correct": s && s.answered ? Math.round((s.correct / s.answered) * 100) : "",
      "First correct": first ? first.names.join(", ") : "",
      "First correct after (s)": first?.elapsed_ms != null ? Math.round(first.elapsed_ms / 100) / 10 : "",
      "Accepted with typos": s?.typo_accepted ?? "",
      "Locked out": s?.voided ?? "",
      "Common wrong answers": (s?.wrong_answers ?? []).slice(0, 5).map((w) => `${w.answer} (${w.count})`).join("; "),
      "Host review changes": reviewSummary(s?.overrides),
    };
  });
}

/** The host's marking changes for one question, in one line. */
export function reviewSummary(o: MarkOverride[] | undefined): string {
  return (o ?? [])
    .map((x) => `${x.part !== null ? `part ${x.part + 1}: ` : ""}${x.label} → ${x.verdict === "CORRECT" ? "correct" : "wrong"} (auto: ${x.auto === "CORRECT" ? "correct" : "wrong"})`)
    .join("; ");
}

export function timelineRows(d: CompetitionDetail): Row[] {
  return timeline(d).map((t) => ({
    Time: clock(t.at, true),
    Question: t.question_index === null ? "" : t.question_index + 1,
    Team: t.team ?? "",
    Event: t.text,
  }));
}
