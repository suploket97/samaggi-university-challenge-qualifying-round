/**
 * The room state machine. Pure and deterministic: given a state and a
 * *resolved* event (a command plus any data the engine fetched for it), it
 * returns the next state or throws. No I/O, no clock reads — `now` is passed in.
 *
 *   WAITING ──START_QUESTION──▶ PLAYING ──TIMER_EXPIRED / END_QUESTION──▶ SUBMITTED_WAITING
 *                                  ▲                                            │
 *                                  │                                      REVEAL_ANSWER
 *                                  │                                            ▼
 *                                  ├────────────START_QUESTION (next)──── REVEAL_ANSWER
 *                                  │                                            │
 *                                  │                                     SHOW_LEADERBOARD
 *                                  │                                            ▼
 *                                  └────────────START_QUESTION (next)──── LEADERBOARD
 *                                                                               │
 *                          (from REVEAL_ANSWER or LEADERBOARD) SHOW_QUALIFICATION
 *                          or, when teams are level on score at the cut, SHOW_TIE_BREAK ──▶ TIE_BREAK ──SHOW_QUALIFICATION
 *                                                                               ▼
 *                                                                   QUALIFICATION_REVEAL
 *   TERMINATE from any phase ──▶ ENDED
 */
import type {
  PublicQuestion,
  QualificationPayload,
  RevealPayload,
  TieBreakPayload,
  RoomCommand,
  RoomPhase,
  RoomState,
  RoomSettings,
  ScoreRow,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";

export class GameError extends Error {
  constructor(
    public code:
      | "ILLEGAL_TRANSITION"
      | "NO_PACK"
      | "NO_MORE_QUESTIONS"
      | "TIMER_NOT_EXPIRED"
      | "VERSION_CONFLICT"
      | "ROOM_NOT_FOUND"
      | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
  }
}

type CommandType = RoomCommand["type"];

/** Which commands are legal in which phase, and where they lead. */
export const TRANSITIONS: Record<RoomPhase, Partial<Record<CommandType, RoomPhase>>> = {
  WAITING: {
    SELECT_PACK: "WAITING",
    START_QUESTION: "PLAYING",
    TERMINATE: "ENDED",
  },
  PLAYING: {
    ADJUST_TIME: "PLAYING",
    MEDIA: "PLAYING",
    TIMER_EXPIRED: "SUBMITTED_WAITING",
    END_QUESTION: "SUBMITTED_WAITING",
    TERMINATE: "ENDED",
  },
  SUBMITTED_WAITING: {
    REVEAL_ANSWER: "REVEAL_ANSWER",
    MEDIA: "SUBMITTED_WAITING",
    TERMINATE: "ENDED",
  },
  REVEAL_ANSWER: {
    SHOW_LEADERBOARD: "LEADERBOARD",
    START_QUESTION: "PLAYING",
    SHOW_TIE_BREAK: "TIE_BREAK",
    SHOW_QUALIFICATION: "QUALIFICATION_REVEAL",
    TERMINATE: "ENDED",
  },
  LEADERBOARD: {
    START_QUESTION: "PLAYING",
    SHOW_TIE_BREAK: "TIE_BREAK",
    SHOW_QUALIFICATION: "QUALIFICATION_REVEAL",
    TERMINATE: "ENDED",
  },
  TIE_BREAK: {
    SHOW_LEADERBOARD: "LEADERBOARD", // back to the table, e.g. to change the number qualifying
    SHOW_QUALIFICATION: "QUALIFICATION_REVEAL",
    TERMINATE: "ENDED",
  },
  QUALIFICATION_REVEAL: {
    SHOW_LEADERBOARD: "LEADERBOARD", // full final table after the cinematic
    TERMINATE: "ENDED",
  },
  ENDED: {},
};

export function allowedCommands(state: RoomState): CommandType[] {
  const cmds = Object.keys(TRANSITIONS[state.phase]) as CommandType[];
  return cmds.filter((c) => {
    if (c === "START_QUESTION") return hasNextQuestion(state);
    if (c === "SELECT_PACK") return state.phase === "WAITING";
    return true;
  });
}

export function hasNextQuestion(state: RoomState): boolean {
  return state.question_ids.length > 0 && state.current_question_index + 1 < state.question_ids.length;
}

export function isLastQuestion(state: RoomState): boolean {
  return state.current_question_index === state.question_ids.length - 1;
}

/**
 * Commands after the engine has attached whatever data they need. Keeping
 * the fetching outside the reducer is what keeps the reducer pure.
 */
export type ResolvedEvent =
  | { type: "SELECT_PACK"; quiz_pack_id: string; question_ids: string[] }
  | { type: "START_QUESTION"; question: PublicQuestion }
  | { type: "END_QUESTION" }
  | { type: "ADJUST_TIME"; delta_sec: number }
  | { type: "TIMER_EXPIRED" }
  | { type: "REVEAL_ANSWER"; reveal: RevealPayload; leaderboard: ScoreRow[] }
  | { type: "SHOW_LEADERBOARD" }
  | { type: "SHOW_TIE_BREAK"; tie_break: TieBreakPayload }
  | { type: "SHOW_QUALIFICATION"; qualification: QualificationPayload }
  | { type: "MEDIA"; action: "PLAY" | "PAUSE" | "RESTART" }
  | { type: "TERMINATE" };

export function createInitialState(
  room_code: string,
  now: number,
  settings: Partial<RoomSettings> = {},
): RoomState {
  return {
    room_code,
    version: 0,
    phase: "WAITING",
    quiz_pack_id: null,
    question_ids: [],
    current_question_index: -1,
    current_question: null,
    question_started_at: null,
    question_ends_at: null,
    reveal: null,
    leaderboard: [],
    qualification: null,
    tie_break: null,
    media: null,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    created_at: now,
    updated_at: now,
  };
}

export function assertCanApply(state: RoomState, type: CommandType): RoomPhase {
  const next = TRANSITIONS[state.phase][type];
  if (!next) {
    throw new GameError("ILLEGAL_TRANSITION", `${type} is not allowed while room is ${state.phase}`);
  }
  if (type === "START_QUESTION") {
    if (!state.quiz_pack_id) throw new GameError("NO_PACK", "Select a quiz pack first");
    if (!hasNextQuestion(state)) throw new GameError("NO_MORE_QUESTIONS", "No questions left in this pack");
  }
  return next;
}

export function transition(state: RoomState, ev: ResolvedEvent, now: number): RoomState {
  const nextPhase = assertCanApply(state, ev.type);
  const base: RoomState = { ...state, phase: nextPhase, version: state.version + 1, updated_at: now };

  switch (ev.type) {
    case "SELECT_PACK":
      if (ev.question_ids.length === 0) throw new GameError("BAD_REQUEST", "Pack has no questions");
      return { ...base, quiz_pack_id: ev.quiz_pack_id, question_ids: ev.question_ids, current_question_index: -1 };

    case "START_QUESTION": {
      const index = state.current_question_index + 1;
      if (ev.question.index !== index || ev.question.question_id !== state.question_ids[index]) {
        throw new GameError("BAD_REQUEST", "Resolved question does not match the next index");
      }
      return {
        ...base,
        current_question_index: index,
        current_question: ev.question,
        question_started_at: now,
        question_ends_at: now + ev.question.time_limit_sec * 1000,
        reveal: null,
        media: null,
      };
    }

    case "ADJUST_TIME": {
      // Never leave less than 3 seconds, so a mis-click can't end the question instantly.
      const start = state.question_started_at ?? now;
      const ends = Math.max(now + 3000, (state.question_ends_at ?? now) + Math.round(ev.delta_sec * 1000));
      const q = state.current_question!;
      return {
        ...base,
        question_ends_at: ends,
        // Keep the countdown ring proportional to the new total.
        current_question: { ...q, time_limit_sec: Math.max(1, Math.round((ends - start) / 1000)) },
      };
    }

    case "TIMER_EXPIRED":
      // Only the server clock decides. Early calls (e.g. a client with a fast
      // clock hitting /tick) are rejected, so they can't cut the question short.
      if (state.question_ends_at === null || now < state.question_ends_at) {
        throw new GameError("TIMER_NOT_EXPIRED", "Timer still running");
      }
      return base;

    case "END_QUESTION":
      // Admin closes early: pull the deadline forward so late submits are refused.
      return { ...base, question_ends_at: Math.min(state.question_ends_at ?? now, now) };

    case "REVEAL_ANSWER":
      return { ...base, reveal: ev.reveal, leaderboard: ev.leaderboard };

    case "SHOW_LEADERBOARD":
      return base;

    case "MEDIA":
      if (!state.current_question?.media_url || (state.current_question.media_type !== "audio" && state.current_question.media_type !== "video")) {
        throw new GameError("BAD_REQUEST", "This question has no sound or video");
      }
      return { ...base, media: { action: ev.action, seq: (state.media?.seq ?? 0) + 1 } };

    case "SHOW_TIE_BREAK":
      return { ...base, tie_break: ev.tie_break };

    case "SHOW_QUALIFICATION":
      return { ...base, qualification: ev.qualification };

    case "TERMINATE":
      return { ...base, question_ends_at: state.phase === "PLAYING" ? now : state.question_ends_at };
  }
}

/** True while the server should accept an answer for the current question. */
export function isAcceptingAnswers(state: RoomState, now: number): boolean {
  return (
    state.phase === "PLAYING" &&
    state.question_ends_at !== null &&
    now <= state.question_ends_at + state.settings.submit_grace_ms
  );
}
