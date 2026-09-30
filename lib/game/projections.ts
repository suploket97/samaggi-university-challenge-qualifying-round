/**
 * Screen projections. Each route subscribes to the same `room:{code}`
 * realtime channel and turns the latest PublicSnapshot into exactly what that
 * screen should render. Pure functions, so they run identically on the server
 * (for the first render) and in the browser (on every broadcast).
 *
 * `serverNow` = Date.now() + clockOffset, where clockOffset is measured from
 * snapshot.server_now when the snapshot arrives. All countdowns use it.
 */
import type { PublicQuestion, RevealPayload, ScoreRow } from "./types";
import type { PublicSnapshot } from "./engine";

export function remainingMs(s: PublicSnapshot, serverNow: number): number {
  return s.question_ends_at === null ? 0 : Math.max(0, s.question_ends_at - serverNow);
}

// ---------------------------------------------------------------------------
// /stage — projector. Read-only, big and cinematic.
// ---------------------------------------------------------------------------

export type StageView =
  | { screen: "LOBBY"; room_code: string }
  | { screen: "QUESTION"; question: PublicQuestion; remaining_ms: number; time_up: boolean }
  | { screen: "LOCKED"; question: PublicQuestion }
  | {
      screen: "REVEAL";
      question: PublicQuestion;
      correct_display: string[];
      accepted_aliases: string[];
      /** Answers the host accepted by hand during the review. */
      host_accepted: string[];
      explanation: string | null;
      answer_distribution: Record<string, number> | null;
      correct_team_count: number;
      /** SUB_QUESTIONS_TEXT: each part's answer and how many teams got it. */
      sub_reveal: RevealPayload["sub_reveal"];
    }
  | { screen: "LEADERBOARD"; rows: ScoreRow[]; after_question: number; total: number }
  | { screen: "QUALIFICATION"; qualified: ScoreRow[]; eliminated: ScoreRow[]; qualify_count: number }
  | { screen: "ENDED" };

export function stageView(s: PublicSnapshot, serverNow: number): StageView {
  switch (s.phase) {
    case "WAITING":
      return { screen: "LOBBY", room_code: s.room_code };
    case "PLAYING": {
      const remaining = remainingMs(s, serverNow);
      return { screen: "QUESTION", question: s.current_question!, remaining_ms: remaining, time_up: remaining === 0 };
    }
    case "SUBMITTED_WAITING":
      return { screen: "LOCKED", question: s.current_question! };
    case "REVEAL_ANSWER": {
      const r = s.reveal!;
      return {
        screen: "REVEAL",
        question: s.current_question!,
        correct_display: r.correct_display,
        accepted_aliases: r.accepted_aliases,
        host_accepted: r.host_accepted ?? [],
        explanation: r.explanation,
        answer_distribution: r.answer_distribution,
        correct_team_count: Object.values(r.results).filter((x) => x.correct).length,
        sub_reveal: r.sub_reveal ?? null,
      };
    }
    case "LEADERBOARD":
      return { screen: "LEADERBOARD", rows: s.leaderboard, after_question: s.current_question_index + 1, total: s.total_questions };
    case "QUALIFICATION_REVEAL": {
      const q = s.qualification!;
      const passed = new Set(q.qualified_team_ids);
      return {
        screen: "QUALIFICATION",
        qualified: q.final_standings.filter((r) => passed.has(r.team_id)),
        eliminated: q.final_standings.filter((r) => !passed.has(r.team_id)),
        qualify_count: q.qualify_count,
      };
    }
    case "ENDED":
      return { screen: "ENDED" };
  }
}

// ---------------------------------------------------------------------------
// /play — one team's phone.
// ---------------------------------------------------------------------------

export interface PlayerContext {
  team_id: string;
  has_submitted: boolean; // from submit response, or /me after reconnect
  frozen: boolean; // anti-cheat voided this question
}

export type PlayerView =
  | { screen: "LOBBY"; room_code: string }
  | {
      screen: "ANSWER";
      question: PublicQuestion;
      controls: "SINGLE_TAP" | "MULTI_SELECT_SUBMIT" | "TEXT_INPUT" | "SUB_TEXT_FORM";
      remaining_ms: number;
    }
  | { screen: "LOCKED_WAITING"; reason: "SUBMITTED" | "TIME_UP" | "FROZEN" }
  | {
      screen: "RESULT";
      outcome: "CORRECT" | "PARTIAL" | "INCORRECT" | "NO_ANSWER" | "VOIDED";
      points: number;
      rank: number | null;
      score: number;
      team_count: number;
      /** SUB_QUESTIONS_TEXT: which parts this team got right. */
      sub_correct: boolean[] | null;
    }
  | { screen: "STANDING"; rank: number | null; score: number; previous_score: number | null; team_count: number; movement: number | null }
  | { screen: "QUALIFICATION"; passed: boolean; rank: number | null }
  | { screen: "ENDED"; rank: number | null; score: number };

export function playerView(s: PublicSnapshot, me: PlayerContext, serverNow: number): PlayerView {
  const row = s.leaderboard.find((r) => r.team_id === me.team_id);
  const team_count = s.leaderboard.length;

  switch (s.phase) {
    case "WAITING":
      return { screen: "LOBBY", room_code: s.room_code };

    case "PLAYING": {
      // Per-player SUBMITTED_WAITING: the room is still PLAYING but this team is done.
      if (me.frozen) return { screen: "LOCKED_WAITING", reason: "FROZEN" };
      if (me.has_submitted) return { screen: "LOCKED_WAITING", reason: "SUBMITTED" };
      const remaining = remainingMs(s, serverNow);
      if (remaining === 0) return { screen: "LOCKED_WAITING", reason: "TIME_UP" };
      const q = s.current_question!;
      return {
        screen: "ANSWER",
        question: q,
        controls:
          q.type === "MCQ_SINGLE" ? "SINGLE_TAP" : q.type === "MCQ_MULTI" ? "MULTI_SELECT_SUBMIT" : q.type === "SUB_QUESTIONS_TEXT" ? "SUB_TEXT_FORM" : "TEXT_INPUT",
        remaining_ms: remaining,
      };
    }

    case "SUBMITTED_WAITING":
      return {
        screen: "LOCKED_WAITING",
        reason: me.frozen ? "FROZEN" : me.has_submitted ? "SUBMITTED" : "TIME_UP",
      };

    case "REVEAL_ANSWER":
      return {
        screen: "RESULT",
        outcome: outcomeFor(s.reveal!, me.team_id),
        points: s.reveal!.results[me.team_id]?.points ?? 0,
        sub_correct: s.reveal!.results[me.team_id]?.sub_correct ?? (s.reveal!.sub_reveal ? s.reveal!.sub_reveal.map(() => false) : null),
        rank: row?.rank ?? null,
        score: row?.score ?? 0,
        team_count,
      };

    case "LEADERBOARD":
      return {
        screen: "STANDING",
        rank: row?.rank ?? null,
        score: row?.score ?? 0,
        previous_score: row?.previous_score ?? null,
        team_count,
        movement: row && row.previous_rank !== null ? row.previous_rank - row.rank : null,
      };

    case "QUALIFICATION_REVEAL": {
      const q = s.qualification!;
      const r = q.final_standings.find((x) => x.team_id === me.team_id);
      return { screen: "QUALIFICATION", passed: q.qualified_team_ids.includes(me.team_id), rank: r?.rank ?? null };
    }

    case "ENDED":
      return { screen: "ENDED", rank: row?.rank ?? null, score: row?.score ?? 0 };
  }
}

function outcomeFor(r: RevealPayload, teamId: string): Extract<PlayerView, { screen: "RESULT" }>["outcome"] {
  const res = r.results[teamId];
  if (!res || !res.answered) return "NO_ANSWER";
  if (res.voided_by_anti_cheat) return "VOIDED";
  if (res.correct) return "CORRECT";
  return res.fraction > 0 ? "PARTIAL" : "INCORRECT";
}

// ---------------------------------------------------------------------------
// /admin — the control panel: which buttons are enabled right now.
// ---------------------------------------------------------------------------

export interface AdminView {
  phase: PublicSnapshot["phase"];
  room_code: string;
  question_label: string | null; // "Q3 / 20"
  remaining_ms: number;
  buttons: {
    selectPack: boolean;
    startQuestion: boolean; // "Start Q1" / "Next question"
    endQuestion: boolean;
    adjustTime: boolean;
    revealAnswer: boolean;
    showLeaderboard: boolean;
    showQualification: boolean;
    terminate: boolean;
  };
}

export function adminView(s: PublicSnapshot, serverNow: number): AdminView {
  const hasNext = s.total_questions > 0 && s.current_question_index + 1 < s.total_questions;
  const p = s.phase;
  return {
    phase: p,
    room_code: s.room_code,
    question_label: s.current_question ? `Q${s.current_question.index + 1} / ${s.total_questions}` : null,
    remaining_ms: p === "PLAYING" ? remainingMs(s, serverNow) : 0,
    buttons: {
      selectPack: p === "WAITING",
      startQuestion: hasNext && (p === "WAITING" || p === "REVEAL_ANSWER" || p === "LEADERBOARD"),
      endQuestion: p === "PLAYING",
      adjustTime: p === "PLAYING",
      revealAnswer: p === "SUBMITTED_WAITING",
      showLeaderboard: p === "REVEAL_ANSWER" || p === "QUALIFICATION_REVEAL",
      showQualification: p === "REVEAL_ANSWER" || p === "LEADERBOARD",
      terminate: p !== "ENDED",
    },
  };
}
