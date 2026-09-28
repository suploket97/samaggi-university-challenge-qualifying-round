/**
 * Shared types for the game engine.
 *
 * Two worlds, deliberately separated:
 *   - Question Bank (Postgres/Supabase): full questions WITH answers. Server-only.
 *   - Live Room (Redis): the running game. Holds a *public* copy of the current
 *     question; answers are pulled from the bank only at REVEAL time.
 */

// ---------------------------------------------------------------------------
// Question Bank (mirrors schemas/question-bank.schema.json)
// ---------------------------------------------------------------------------

export type QuestionType = "MCQ_SINGLE" | "MCQ_MULTI" | "TEXT_INPUT" | "SUB_QUESTIONS_TEXT";

/**
 * One part of a SUB_QUESTIONS_TEXT question. Each part gets its own answer
 * box on the phone and is marked on its own; the question's score is the
 * sum of the parts answered correctly.
 */
export interface SubQuestion {
  /** Stable id within the question, e.g. "1", "2", "a". */
  sub_id: string;
  prompt: string;
  /** Accepted answers; the first is shown on the big screen at the reveal. */
  correct_answers_array: string[];
  /** Points for this part. Default: the question's base points split evenly. */
  points?: number;
}

export const MAX_SUB_QUESTIONS = 20;
/** Choices are lettered A–Z, so a question can have up to 26. */
export type ChoiceId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z";
export const CHOICE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") as ChoiceId[];
export const MAX_CHOICES = 26;

export interface SpeedTier {
  within_sec: number;
  bonus: number;
}

export interface Choice {
  choice_id: ChoiceId;
  /** May be empty when the choice is a picture. */
  text: string;
  media_url?: string;
}

export interface BankQuestion {
  question_id: string;
  quiz_pack_id: string;
  order?: number;
  type: QuestionType;
  question_text: string;
  media_url?: string | null;
  media_type?: "image" | "audio" | "video";
  show_media_on_player?: boolean;
  choices?: Choice[];
  /** MCQ: choice ids. TEXT_INPUT: [canonical, ...aliases]. SUB_QUESTIONS_TEXT: empty (answers live on each part). */
  correct_answers_array: string[];
  /** SUB_QUESTIONS_TEXT only. */
  sub_questions?: SubQuestion[];
  text_matching?: { fuzzy?: boolean; max_typos?: 0 | 1 | 2; ignore_articles?: boolean };
  multi_scoring?: "PARTIAL" | "ALL_OR_NOTHING";
  time_limit_sec?: number;
  base_points?: number;
  speed_tiers?: SpeedTier[];
  explanation?: string;
}

/** What players and the stage may see while a question is open. No answers. */
export interface PublicQuestion {
  question_id: string;
  index: number; // 0-based position in the pack
  total: number; // questions in the pack
  type: QuestionType;
  question_text: string;
  media_url: string | null;
  media_type: "image" | "audio" | "video" | null;
  show_media_on_player: boolean;
  choices: Choice[] | null;
  /** SUB_QUESTIONS_TEXT: the parts, without their answers. */
  sub_questions: { sub_id: string; prompt: string; points: number }[] | null;
  /** MCQ_MULTI: how many options to pick is intentionally NOT exposed. */
  time_limit_sec: number;
}

// ---------------------------------------------------------------------------
// Live room
// ---------------------------------------------------------------------------

/**
 * Room-level phase. Every screen renders from this.
 *
 * SUBMITTED_WAITING at room level means "the question is closed (timer hit 0
 * or admin ended it) and we're waiting for the admin to reveal". A single
 * player who submits early is also shown the waiting screen, but that is a
 * per-player view derived in projections.ts — the room is still PLAYING.
 */
export type RoomPhase =
  | "WAITING" // lobby: teams join, stage shows room code
  | "PLAYING" // a question is open, timer running
  | "SUBMITTED_WAITING" // question closed, answers sealed, awaiting reveal
  | "REVEAL_ANSWER" // correct answer + per-team results shown
  | "LEADERBOARD" // stage shows standings
  | "QUALIFICATION_REVEAL" // top X teams pass
  | "ENDED"; // room closed

export interface Team {
  team_id: string;
  name: string;
  joined_at: number;
  /** Set by anti-cheat. A frozen team's answer for the current question is voided. */
  flags: AntiCheatFlag[];
  frozen_for_question: number | null;
}

export interface AntiCheatFlag {
  question_index: number;
  kind: "FOCUS_LOST" | "PASTE_ATTEMPT";
  duration_ms?: number;
  at: number;
}

export interface Submission {
  team_id: string;
  question_index: number;
  /** MCQ: choice ids. TEXT_INPUT: [rawText]. SUB_QUESTIONS_TEXT: one entry per part, in order ("" = left blank). */
  answer: string[];
  /** Server receive time. Never trust a client timestamp for scoring. */
  received_at: number;
}

export interface QuestionResult {
  team_id: string;
  correct: boolean;
  /** 0..1 for partial MCQ_MULTI credit; 1 or 0 otherwise. */
  fraction: number;
  /** SUB_QUESTIONS_TEXT: which parts were right, in order. */
  sub_correct?: boolean[];
  base_points: number;
  speed_bonus: number;
  points: number;
  answered: boolean;
  elapsed_ms: number | null;
  voided_by_anti_cheat: boolean;
}

export interface ScoreRow {
  team_id: string;
  name: string;
  score: number;
  correct_count: number;
  /** Sum of elapsed ms on correct answers — tie-breaker (lower is better). */
  total_correct_time_ms: number;
  rank: number;
  /** Rank before the last reveal, so the stage can animate movement. */
  previous_rank: number | null;
  /** Score before the last reveal, so scores can roll up like an odometer. */
  previous_score: number | null;
}

export interface RevealPayload {
  question_index: number;
  question_id: string;
  type: QuestionType;
  /** MCQ: correct choice ids. TEXT_INPUT: canonical answer. */
  correct_display: string[];
  /** TEXT_INPUT aliases (everything after the canonical answer). */
  accepted_aliases: string[];
  explanation: string | null;
  results: Record<string, Pick<QuestionResult, "correct" | "points" | "fraction" | "answered" | "voided_by_anti_cheat" | "sub_correct">>;
  /** SUB_QUESTIONS_TEXT: each part's answer and how many teams got it. */
  sub_reveal: { sub_id: string; prompt: string; answer: string; aliases: string[]; points: number; correct_teams: number }[] | null;
  answer_distribution: Record<string, number> | null; // MCQ only: choice -> count
}

export interface QualificationPayload {
  qualify_count: number;
  qualified_team_ids: string[];
  final_standings: ScoreRow[];
}

/**
 * The single source of truth for a running room, stored in Redis as JSON
 * under room:{code}:state. `version` increments on every transition and is
 * used for optimistic concurrency and for clients to discard stale updates.
 */
export interface RoomState {
  room_code: string;
  version: number;
  phase: RoomPhase;
  quiz_pack_id: string | null;
  question_ids: string[]; // ordered ids of the selected pack
  current_question_index: number; // -1 before the first question
  current_question: PublicQuestion | null;
  /** Server epoch ms. Clients render the countdown from these + clock offset. */
  question_started_at: number | null;
  question_ends_at: number | null;
  reveal: RevealPayload | null;
  leaderboard: ScoreRow[];
  qualification: QualificationPayload | null;
  settings: RoomSettings;
  created_at: number;
  updated_at: number;
}

export interface RoomSettings {
  /** Leave a little slack for network latency on the final second. */
  submit_grace_ms: number;
  /** Focus lost for longer than this flags the team. */
  focus_violation_ms: number;
  anti_cheat_policy: "FLAG_ONLY" | "VOID_CURRENT_ANSWER";
  max_teams: number;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  submit_grace_ms: 750,
  focus_violation_ms: 3000,
  anti_cheat_policy: "VOID_CURRENT_ANSWER",
  max_teams: 200,
};

// ---------------------------------------------------------------------------
// Commands (the only way the room changes)
// ---------------------------------------------------------------------------

export type AdminCommand =
  | { type: "SELECT_PACK"; quiz_pack_id: string }
  | { type: "START_QUESTION"; time_limit_sec?: number } // releases the next question; optional time override
  | { type: "ADJUST_TIME"; delta_sec: number } // add (or remove) time while a question is open
  | { type: "END_QUESTION" } // close early, before the timer ends
  | { type: "REVEAL_ANSWER" }
  | { type: "SHOW_LEADERBOARD" }
  | { type: "SHOW_QUALIFICATION"; qualify_count: number }
  | { type: "TERMINATE" };

export type SystemCommand = { type: "TIMER_EXPIRED" };

export type RoomCommand = AdminCommand | SystemCommand;
