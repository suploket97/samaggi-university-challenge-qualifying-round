/**
 * Competition log: what the engine hands to a recorder after every change to a
 * room, so a permanent record can be kept for settling disputes.
 *
 * The engine calls the recorder AFTER the change is saved and broadcast, and a
 * recorder failure never stops the game (see GameEngine.recordSafely).
 */
import type { AntiCheatFlag, BankQuestion, RoomCommand, RoomState, Team } from "./types";
import type { PackInfo } from "./engine";
import { effectiveChoiceKey, judgeText, markSubQuestions, type MarkOverride, type Overrides, type TextMatch } from "./scoring";
import { describeSequence, markSequence, sequenceLength, sequenceReviewKey } from "./sequence";

/** How an answer was marked, in enough detail to explain it to a team. */
export interface AnswerMarking {
  /** TEXT_INPUT */
  text?: TextMatch;
  /** MCQ: what the team picked and what was right (after any host changes to the key). */
  picked?: string[];
  correct_ids?: string[];
  /** MCQ: the answer key as written, when the host changed it during the review. */
  original_ids?: string[];
  /** SUB_QUESTIONS_TEXT: every part on its own. */
  parts?: { given: string; match: TextMatch; correct: boolean; points: number }[];
  /** ORDERING / MATCHING: the answer in words, which positions were right, and any host decision on it. */
  sequence?: { given: string; correct: boolean[]; hits: number; n: number; override?: "CORRECT" | "WRONG" };
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
  /** DECAY scoring: the share of the points kept for the time taken (1 = instantly, 0.5 = at the buzzer). */
  time_factor?: number;
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
  /** REVEAL_ANSWER: the host's marking changes that were applied. */
  overrides?: MarkOverride[];
}

/** A host marking change during the review, logged the moment it is made. */
export interface ReviewEvent {
  question_index: number;
  question_id: string;
  key: string;
  label: string;
  part: number | null;
  /** null = the change was undone (back to automatic marking). */
  verdict: "CORRECT" | "WRONG" | null;
  auto: "CORRECT" | "WRONG";
  /** Teams whose answer this covered at the moment of the change. */
  teams: string[];
}

export interface GameRecorder {
  onTransition(input: RecordInput): Promise<void>;
  onRoomDeleted(state: RoomState, at: number): Promise<void>;
  onReview?(state: RoomState, at: number, ev: ReviewEvent): Promise<void>;
}

export const noopRecorder: GameRecorder = {
  async onTransition() {},
  async onRoomDeleted() {},
};

/** A competition is one room's game. Room codes can repeat, so the start time is part of the id. */
export function competitionId(state: Pick<RoomState, "room_code" | "created_at">): string {
  return `${state.room_code}-${state.created_at}`;
}

export function explainAnswer(q: BankQuestion, answer: string[], basePoints: number, overrides?: Overrides): AnswerMarking {
  switch (q.type) {
    case "TEXT_INPUT":
      return { text: judgeText(answer[0] ?? "", q, overrides).match };
    case "SUB_QUESTIONS_TEXT": {
      const m = markSubQuestions(q, answer, basePoints, overrides);
      return {
        parts: (q.sub_questions ?? []).map((sq, i) => {
          const given = (answer[i] ?? "").trim();
          return {
            given,
            match: given ? judgeText(given, { ...q, correct_answers_array: sq.correct_answers_array }, overrides, i).match : { kind: "BLANK" as const },
            correct: m.correct[i] ?? false,
            points: m.correct[i] ? m.points[i] : 0,
          };
        }),
      };
    }
    case "ORDERING":
    case "MATCHING": {
      const m = markSequence(sequenceLength(q), answer);
      const o = overrides?.[sequenceReviewKey(answer)];
      return { sequence: { given: describeSequence(q, answer), correct: m.correct, hits: m.hits, n: m.n, ...(o ? { override: o.verdict } : {}) } };
    }
    default: {
      const key = effectiveChoiceKey(q, overrides);
      const changed = key.join() !== [...q.correct_answers_array].join();
      return { picked: [...answer], correct_ids: key, ...(changed ? { original_ids: [...q.correct_answers_array] } : {}) };
    }
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
  /** Marking the host changed during the review before the reveal. */
  overrides?: MarkOverride[];
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

export function questionStats(q: BankQuestion, answers: AnswerRecord[], overrides: MarkOverride[] = []): QuestionStats {
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
    ...(overrides.length ? { overrides } : {}),
  };
  if (q.type === "TEXT_INPUT") {
    stats.wrong_answers = topCounts(wrongOnes.map((a) => a.answer?.[0] ?? ""), 10);
  } else if (q.type === "SUB_QUESTIONS_TEXT") {
    stats.parts = (q.sub_questions ?? []).map((_, i) => {
      const parts = answered.map((a) => a.marking?.parts?.[i]).filter((p): p is NonNullable<typeof p> => !!p);
      return { correct: parts.filter((p) => p.correct).length, wrong_answers: topCounts(parts.filter((p) => !p.correct && p.given).map((p) => p.given), 5) };
    });
  } else if (q.type === "ORDERING" || q.type === "MATCHING") {
    // The most common answers that weren't fully right.
    stats.wrong_answers = topCounts(answered.filter((a) => !a.correct).map((a) => a.marking?.sequence?.given ?? ""), 10);
  } else {
    // MCQ: how often each wrong choice was picked.
    const right = new Set(answers.find((a) => a.marking?.correct_ids)?.marking?.correct_ids ?? q.correct_answers_array);
    stats.wrong_answers = topCounts(answered.flatMap((a) => (a.answer ?? []).filter((c) => !right.has(c))), 26);
  }
  return stats;
}
