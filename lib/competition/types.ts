/**
 * Competition log as the admin pages receive it (see lib/server/competitions.ts).
 * Times are ISO strings from the database; answer times inside results are epoch ms.
 */
import type { AntiCheatFlag, BankQuestion, QualificationPayload, RoomSettings, ScoreRow } from "@/lib/game/types";
import type { AnswerRecord, QuestionStats } from "@/lib/game/recorder";

export type { AnswerRecord, QuestionStats };

export interface CompetitionTeam {
  team_id: string;
  name: string;
  joined_at: string | null;
  flags: AntiCheatFlag[];
}

export interface CompetitionRecord {
  competition_id: string;
  room_code: string;
  pack_id: string | null;
  pack_title: string | null;
  status: "LIVE" | "FINISHED";
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  question_total: number;
  questions_played: number;
  settings: RoomSettings | null;
  teams: CompetitionTeam[];
  standings: ScoreRow[];
  qualification: QualificationPayload | null;
}

export interface CompetitionSummary {
  competition_id: string;
  room_code: string;
  pack_title: string | null;
  status: "LIVE" | "FINISHED";
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  question_total: number;
  questions_played: number;
  team_count: number;
  qualified_count: number | null;
  leader: string | null;
}

export interface CompetitionQuestion {
  question_index: number;
  question: BankQuestion;
  effective: { time_limit_sec: number; base_points: number; speed_tiers: { within_sec: number; bonus: number }[] | null; time_override: number | null };
  started_at: string | null;
  planned_end_at: string | null;
  closed_at: string | null;
  closed_by: "HOST" | "TIMER" | null;
  revealed_at: string | null;
  results: AnswerRecord[] | null;
  stats: QuestionStats | null;
}

export interface CompetitionEvent {
  event_id: number;
  at: string;
  kind: string;
  question_index: number | null;
  detail: Record<string, unknown> | null;
}

export interface CompetitionDetail {
  competition: CompetitionRecord;
  questions: CompetitionQuestion[];
  events: CompetitionEvent[];
  /** Short code computed from the whole record: re-export later and compare to show nothing changed. */
  fingerprint: string;
}
