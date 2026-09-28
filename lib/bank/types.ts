import type { BankQuestion, SpeedTier } from "@/lib/game/types";

export interface ImportPack {
  quiz_pack_id: string;
  title: string;
  description?: string;
  default_time_limit_sec?: number;
  default_base_points?: number;
  speed_tiers?: SpeedTier[];
  tags?: string[];
}

/** Matches schemas/question-bank.schema.json. */
export interface ImportDoc {
  schema_version: 1;
  quiz_packs: ImportPack[];
  questions: BankQuestion[];
}

export interface ImportIssue {
  /** Index into doc.questions, or null for file-level problems. */
  question_index: number | null;
  message: string;
}
