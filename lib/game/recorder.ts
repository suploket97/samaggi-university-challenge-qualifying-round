/**
 * Competition log: what the engine hands to a recorder after every change to a
 * room, so a permanent record can be kept for settling disputes.
 *
 * The engine calls the recorder AFTER the change is saved and broadcast, and a
 * recorder failure never stops the game (see GameEngine.recordSafely).
 */
import type { AntiCheatFlag, BankQuestion, RoomCommand, RoomState, Team } from "./types";
import type { PackInfo } from "./engine";
import { explainTextMatch, markSubQuestions, type TextMatch } from "./scoring";

/** How an answer was marked, in enough detail to explain it to a team. */
export interface AnswerMarking {
  /** TEXT_INPUT */
  text?: TextMatch;
  /** MCQ: what the team picked and what was right. */
  picked?: string[];
  correct_ids?: string[];
  /** SUB_QUESTIONS_TEXT: every part on its own. */
  parts?: { given: string; match: TextMatch; correct: boolean; points: number }[];
}

/** One team's answer to one question, as marked at the reveal. */
export interface AnswerRecord {
  team_id: string;
  team_name: string;
  answered: boolean;
  /** Exactly what arrived: choice ids, the typed text, or one entry per part. */
  answer: string[] | null;
  /** Server clock (epoch ms). */
  received_at: number | null;
  /** From the moment the question opened. */
  elapsed_ms: number | null;
  correct: boolean;
  fraction: number;
  base_points: number;
  speed_bonus: number;
  points: number;
  /** Locked out of this question because the team left the quiz screen before answering. */
  voided: boolean;
  marking: AnswerMarking | null;
  /** Anti-cheat flags raised during this question. */
  flags: AntiCheatFlag[];
}

export interface RecordInput {
  command: RoomCommand;
  prev: RoomState;
  next: RoomState;
  /** Server clock when the change was made. */
  at: number;
  /** START_QUESTION / REVEAL_ANSWER: the full question (with answers) as it was used. */
  question?: BankQuestion;
  pack?: PackInfo;
  /** REVEAL_ANSWER: every team's marked answer. */
  answers?: AnswerRecord[];
  /** REVEAL_ANSWER / SHOW_QUALIFICATION / TERMINATE: teams with their flags. */
  teams?: Team[];
}

export interface GameRecorder {
  onTransition(input: RecordInput): Promise<void>;
  onRoomDeleted(state: RoomState, at: number): Promise<void>;
}

export const noopRecorder: GameRecorder = {
  async onTransition() {},
  async onRoomDeleted() {},
};

/** A competition is one room's game. Room codes can repeat, so the start time is part of the id. */
export function competitionId(state: Pick<RoomState, "room_code" | "created_at">): string {
  return `${state.room_code}-${state.created_at}`;
}

export function explainAnswer(q: BankQuestion, answer: string[], basePoints: number): AnswerMarking {
  switch (q.type) {
    case "TEXT_INPUT":
      return { text: explainTextMatch(answer[0] ?? "", q) };
    case "SUB_QUESTIONS_TEXT": {
      const m = markSubQuestions(q, answer, basePoints);
      return {
        parts: (q.sub_questions ?? []).map((sq, i) => {
          const given = (answer[i] ?? "").trim();
          return {
            given,
            match: given ? explainTextMatch(given, { ...q, correct_answers_array: sq.correct_answers_array }) : { kind: "BLANK" as const },
            correct: m.correct[i] ?? false,
            points: m.correct[i] ? m.points[i] : 0,
          };
        }),
      };
    }
    default:
      return { picked: [...answer], correct_ids: [...q.correct_answers_array] };
  }
}

// ---------------------------------------------------------------------------
// Per-question statistics, stored with each question in the log.
// ---------------------------------------------------------------------------

export interface QuestionStats {
  teams: number;
  answered: number;
  correct: number;
  partial: number;
  wrong: number;
  no_answer: number;
  voided: number;
  /** Answers accepted only thanks to the typo allowance. */
  typo_accepted: number;
  avg_correct_ms: number | null;
  /** Most common wrong answers (typed text, or choice ids for MCQ). */
  wrong_answers: { answer: string; count: number }[];
  /** SUB_QUESTIONS_TEXT: the same for each part. */
  parts?: { correct: number; wrong_answers: { answer: string; count: number }[] }[];
}

function topCounts(values: string[], limit: number) {
  // Group spelling variants of the same answer ("bangkok", "Bangkok ") under the first form seen.
  const groups = new Map<string, { answer: string; count: number }>();
  for (const v of values) {
    const key = v.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { answer: v.trim(), count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer)).slice(0, limit);
}

export function questionStats(q: BankQuestion, answers: AnswerRecord[]): QuestionStats {
  const answered = answers.filter((a) => a.answered && !a.voided);
  const correct = answered.filter((a) => a.correct);
  const partial = answered.filter((a) => !a.correct && a.fraction > 0);
  const wrongOnes = answered.filter((a) => !a.correct && a.fraction === 0);
  const times = correct.map((a) => a.elapsed_ms ?? 0);
  const typo =
    q.type === "TEXT_INPUT"
      ? answered.filter((a) => a.marking?.text?.kind === "TYPO").length
      : q.type === "SUB_QUESTIONS_TEXT"
        ? answered.reduce((n, a) => n + (a.marking?.parts ?? []).filter((p) => p.match.kind === "TYPO").length, 0)
        : 0;
  const stats: QuestionStats = {
    teams: answers.length,
    answered: answered.length,
    correct: correct.length,
    partial: partial.length,
    wrong: wrongOnes.length,
    no_answer: answers.filter((a) => !a.answered).length,
    voided: answers.filter((a) => a.voided).length,
    typo_accepted: typo,
    avg_correct_ms: times.length ? Math.round(times.reduce((x, y) => x + y, 0) / times.length) : null,
    wrong_answers: [],
  };
  if (q.type === "TEXT_INPUT") {
    stats.wrong_answers = topCounts(wrongOnes.map((a) => a.answer?.[0] ?? ""), 10);
  } else if (q.type === "SUB_QUESTIONS_TEXT") {
    stats.parts = (q.sub_questions ?? []).map((_, i) => {
      const parts = answered.map((a) => a.marking?.parts?.[i]).filter((p): p is NonNullable<typeof p> => !!p);
      return { correct: parts.filter((p) => p.correct).length, wrong_answers: topCounts(parts.filter((p) => !p.correct && p.given).map((p) => p.given), 5) };
    });
  } else {
    // MCQ: how often each wrong choice was picked.
    const right = new Set(q.correct_answers_array);
    stats.wrong_answers = topCounts(answered.flatMap((a) => (a.answer ?? []).filter((c) => !right.has(c))), 26);
  }
  return stats;
}
