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

export type QuestionType = "MCQ_SINGLE" | "MCQ_MULTI" | "TRUE_FALSE" | "TEXT_INPUT" | "SUB_QUESTIONS_TEXT" | "ORDERING" | "MATCHING";

export const QUESTION_TYPES: QuestionType[] = ["MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE", "TEXT_INPUT", "SUB_QUESTIONS_TEXT", "ORDERING", "MATCHING"];

/** Short names for the host screens. */
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  MCQ_SINGLE: "One answer",
  MCQ_MULTI: "Several answers",
  TRUE_FALSE: "True or false",
  TEXT_INPUT: "Typed answer",
  SUB_QUESTIONS_TEXT: "Sub-questions",
  ORDERING: "Put in order",
  MATCHING: "Matching",
};

/** Types answered by tapping choices (A, B, C…) and marked against an answer key. */
export function isChoiceType(t: QuestionType): t is "MCQ_SINGLE" | "MCQ_MULTI" | "TRUE_FALSE" {
  return t === "MCQ_SINGLE" || t === "MCQ_MULTI" || t === "TRUE_FALSE";
}

/** Types whose answer is a sequence (an order, or one match per item), marked position by position. */
export function isSequenceType(t: QuestionType): t is "ORDERING" | "MATCHING" {
  return t === "ORDERING" || t === "MATCHING";
}

/** Ordering and matching: at least 2 and at most this many items. */
export const MAX_SEQUENCE_ITEMS = 10;

/** MATCHING: one pair. The answer key is that each left goes with its own right. */
export interface MatchPair {
  left: string;
  right: string;
}

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
  /**
   * MCQ: the options. TRUE_FALSE: exactly two, A = true and B = false (labels can be changed, e.g. "จริง" / "เท็จ").
   * ORDERING: the items written IN THE CORRECT ORDER (A first). Phones get them shuffled.
   */
  choices?: Choice[];
  /**
   * MCQ / TRUE_FALSE: choice ids. TEXT_INPUT: [canonical, ...aliases].
   * SUB_QUESTIONS_TEXT: empty (answers live on each part).
   * ORDERING / MATCHING: the ids in order ("A","B","C"…), kept for readability; the key is always that order.
   */
  correct_answers_array: string[];
  /** SUB_QUESTIONS_TEXT only. */
  sub_questions?: SubQuestion[];
  /** MATCHING only: each left goes with its own right. Phones get the rights shuffled. */
  pairs?: MatchPair[];
  text_matching?: { fuzzy?: boolean; max_typos?: 0 | 1 | 2; ignore_articles?: boolean };
  /** MCQ_MULTI, ORDERING, MATCHING: partial credit (default) or all-or-nothing. */
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
  /**
   * MCQ / TRUE_FALSE: the options. ORDERING: the items, shuffled. MATCHING: the right-hand side, shuffled.
   * For ORDERING and MATCHING the letters are display letters (A = first shown), so they reveal nothing.
   */
  choices: Choice[] | null;
  /** MATCHING: the left-hand side, in the author's order. Each needs one letter from `choices`. */
  match_left?: string[] | null;
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
  | "TIE_BREAK" // teams level on score at the qualification cut: how the tie-break settled it
  | "QUALIFICATION_REVEAL" // top X teams pass
  | "ENDED"; // room closed

export interface Team {
  team_id: string;
  name: string;
  joined_at: number;
  /** Set by anti-cheat. A frozen team's answer for the current question is voided. */
  flags: AntiCheatFlag[];
  frozen_for_question: number | null;
  /** Bumped each time the host moves the team to a new device; older devices' tokens stop working. */
  device?: number;
  /** One-time code the host issued to move the team to a new device. */
  transfer?: { code: string; expires_at: number } | null;
}

/**
 * What each team got for a question at its reveal (kept in the live room), so
 * the host can correct the marking afterwards and the scores can be adjusted.
 */
export interface QuestionResultRecord {
  started_at: number;
  ends_at: number;
  /** Teams locked out of this question by anti-cheat. */
  voided: string[];
  results: Record<string, { points: number; correct: boolean; elapsed_ms: number | null }>;
}

export interface AntiCheatFlag {
  question_index: number;
  /** WINDOW_BLUR: the quiz page stayed visible but another window had the focus (computers). Flag only, never voids. */
  kind: "FOCUS_LOST" | "PASTE_ATTEMPT" | "WINDOW_BLUR";
  duration_ms?: number;
  at: number;
}

export interface Submission {
  team_id: string;
  question_index: number;
  /**
   * MCQ: choice ids. TEXT_INPUT: [rawText]. SUB_QUESTIONS_TEXT: one entry per part, in order ("" = left blank).
   * ORDERING: the items in the order the team put them, as the question's own ids (A = first in the correct order).
   * MATCHING: for each left in turn, the id of the right the team picked (A = the right of pair 1; "" = left blank).
   * ORDERING / MATCHING are stored in the question's own ids (not the shuffled display letters), so the log reads the same as the bank.
   */
  answer: string[];
  /** Server receive time. Never trust a client timestamp for scoring. */
  received_at: number;
}

export interface QuestionResult {
  team_id: string;
  correct: boolean;
  /** 0..1 for partial credit (MCQ_MULTI, sub-questions, ordering, matching); 1 or 0 otherwise. */
  fraction: number;
  /** SUB_QUESTIONS_TEXT: which parts were right, in order. */
  sub_correct?: boolean[];
  base_points: number;
  speed_bonus: number;
  /** DECAY scoring: the share of the points kept for answering at that moment (1 = instantly, 0.5 = at the buzzer). */
  time_factor?: number;
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
  /** Answers the host accepted by hand during the review (typed answers and parts). */
  host_accepted?: string[];
  /** How many marking decisions the host changed for this question. */
  review_changes?: number;
  explanation: string | null;
  results: Record<string, Pick<QuestionResult, "correct" | "points" | "fraction" | "answered" | "voided_by_anti_cheat" | "sub_correct">>;
  /** ORDERING: the items in the correct order. MATCHING: "left → right" for each pair. */
  sequence_reveal?: { text: string; media_url?: string; correct_teams: number }[] | null;
  /** SUB_QUESTIONS_TEXT: each part's answer and how many teams got it. */
  sub_reveal: { sub_id: string; prompt: string; answer: string; aliases: string[]; points: number; correct_teams: number }[] | null;
  answer_distribution: Record<string, number> | null; // MCQ only: choice -> count
}

/**
 * Teams level on score at the qualification cut, and how the tie-break
 * (correct answers, then total time on correct answers) separated them.
 * NONE = level on all three, so every team in the group qualifies.
 */
export interface TieBreakPayload {
  qualify_count: number;
  score: number;
  decided_by: "CORRECT" | "TIME" | "NONE";
  /** The tied group in final order, each marked qualified or not. */
  rows: (ScoreRow & { qualified: boolean })[];
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
  /** Set by SHOW_TIE_BREAK; kept so the qualification step can explain the cut. */
  tie_break?: TieBreakPayload | null;
  /** Host's remote control for the question's sound or video on the big screen. seq increases on every press. */
  media?: MediaControl | null;
  settings: RoomSettings;
  /** Server-only (never sent to screens): shuffles ordering and matching items so the display order can't be worked out. */
  secret_seed?: string;
  created_at: number;
  updated_at: number;
}

export interface MediaControl {
  action: "PLAY" | "PAUSE" | "RESTART";
  seq: number;
}

export interface RoomSettings {
  /** Leave a little slack for network latency on the final second. */
  submit_grace_ms: number;
  /** Focus lost for longer than this flags the team. */
  focus_violation_ms: number;
  anti_cheat_policy: "FLAG_ONLY" | "VOID_CURRENT_ANSWER";
  max_teams: number;
  /**
   * Chosen when the room is created:
   *   CLASSIC   full points for a right answer, plus the speed bonus (+20 within 5 s, +10 within 10 s by default)
   *   ACCURACY  full points for a right answer whenever it arrives in time; no speed bonus
   *   DECAY     points shrink steadily with time: 100% at once, 50% at the buzzer; no separate bonus
   * Missing (rooms made before this setting existed) = CLASSIC.
   */
  scoring_mode?: ScoringMode;
}

export type ScoringMode = "CLASSIC" | "ACCURACY" | "DECAY";
export const SCORING_MODES: ScoringMode[] = ["CLASSIC", "ACCURACY", "DECAY"];
/** DECAY: the share of the points still given for an answer that arrives at the very end. */
export const DECAY_FLOOR = 0.5;

export const DEFAULT_SETTINGS: RoomSettings = {
  submit_grace_ms: 750,
  focus_violation_ms: 3000,
  anti_cheat_policy: "VOID_CURRENT_ANSWER",
  max_teams: 200,
  scoring_mode: "CLASSIC",
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
  | { type: "SHOW_TIE_BREAK"; qualify_count: number } // only when teams are level on score at the cut
  | { type: "SHOW_QUALIFICATION"; qualify_count: number }
  | { type: "MEDIA"; action: MediaControl["action"] } // play/pause the question's sound or video on the stage
  | { type: "TERMINATE" };

export type SystemCommand = { type: "TIMER_EXPIRED" };

export type RoomCommand = AdminCommand | SystemCommand;
