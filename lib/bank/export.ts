/**
 * Question pack → spreadsheet rows, in exactly the columns the importer reads
 * (lib/bank/rows.ts). An exported pack can be edited in Excel or Google Sheets
 * and imported back; question ids are kept, so re-importing updates rather
 * than duplicates.
 */
import { CHOICE_LETTERS, MAX_SUB_QUESTIONS, type BankQuestion } from "@/lib/game/types";

export interface ExportPack {
  quiz_pack_id: string;
  title: string;
  description?: string | null;
  default_time_limit_sec: number;
}

export type ExportRow = Record<string, string | number>;

export function questionsToRows(pack: ExportPack, questions: BankQuestion[]): { columns: string[]; rows: ExportRow[] } {
  return packsToRows([{ pack, questions }]);
}

/**
 * Several packs in one sheet (a backup of the whole question bank). Each
 * pack's details sit on its first row; importing the file recreates every pack.
 */
export function packsToRows(list: { pack: ExportPack; questions: BankQuestion[] }[]): { columns: string[]; rows: ExportRow[] } {
  const questions = list.flatMap((x) => x.questions);
  const maxChoices = Math.max(0, ...questions.map((q) => q.choices?.length ?? 0));
  const choicePics = questions.some((q) => q.choices?.some((c) => c.media_url));
  const maxParts = Math.min(MAX_SUB_QUESTIONS, Math.max(0, ...questions.map((q) => q.sub_questions?.length ?? 0)));

  const columns = [
    "quiz_pack_id", "pack_title", "pack_description", "pack_time_limit_sec",
    "question_id", "type", "question_text", "correct_answers",
    ...CHOICE_LETTERS.slice(0, maxChoices).map((L) => `choice_${L.toLowerCase()}`),
    ...(choicePics ? CHOICE_LETTERS.slice(0, maxChoices).map((L) => `choice_${L.toLowerCase()}_image`) : []),
    ...Array.from({ length: maxParts }, (_, i) => [`sub_${i + 1}_question`, `sub_${i + 1}_answers`, `sub_${i + 1}_points`]).flat(),
    "media_url", "media_type", "show_on_phones", "time_limit_sec", "base_points", "multi_scoring", "fuzzy", "max_typos", "explanation",
  ];

  const rows = list.flatMap(({ pack, questions }) => questions.map((q, i) => {
    const r: ExportRow = {};
    for (const c of columns) r[c] = "";
    if (i === 0) {
      // Pack details once, on the first row; the importer carries the pack down.
      r.pack_title = pack.title;
      r.pack_description = pack.description ?? "";
      r.pack_time_limit_sec = pack.default_time_limit_sec;
    }
    r.quiz_pack_id = pack.quiz_pack_id;
    r.question_id = q.question_id;
    r.type = q.type;
    r.question_text = q.question_text;
    r.correct_answers = q.type === "SUB_QUESTIONS_TEXT" ? "" : q.correct_answers_array.join(" | ");
    (q.choices ?? []).forEach((c, j) => {
      const L = CHOICE_LETTERS[j].toLowerCase();
      r[`choice_${L}`] = c.text;
      if (choicePics && c.media_url) r[`choice_${L}_image`] = c.media_url;
    });
    (q.sub_questions ?? []).slice(0, maxParts).forEach((sq, j) => {
      r[`sub_${j + 1}_question`] = sq.prompt;
      r[`sub_${j + 1}_answers`] = sq.correct_answers_array.join(" | ");
      r[`sub_${j + 1}_points`] = sq.points ?? "";
    });
    r.media_url = q.media_url ?? "";
    r.media_type = q.media_url ? q.media_type ?? "" : "";
    r.show_on_phones = q.media_url && q.show_media_on_player !== undefined ? (q.show_media_on_player ? "yes" : "no") : "";
    r.time_limit_sec = q.time_limit_sec ?? "";
    r.base_points = q.base_points ?? "";
    r.multi_scoring = q.type === "MCQ_MULTI" ? q.multi_scoring ?? "" : "";
    r.fuzzy = q.text_matching?.fuzzy === undefined ? "" : q.text_matching.fuzzy ? "yes" : "no";
    r.max_typos = q.text_matching?.max_typos ?? "";
    r.explanation = q.explanation ?? "";
    return r;
  }));
  return { columns, rows };
}
