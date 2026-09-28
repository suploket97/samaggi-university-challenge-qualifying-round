/**
 * Turns spreadsheet rows (from CSV or Excel) into an ImportDoc. Runs in the
 * admin's browser so the preview is instant; the server validates again.
 *
 * Columns (header names are forgiving — case, spaces and common synonyms):
 *   quiz_pack_id | pack_title | pack_description | question_id | type |
 *   question_text | choice_a … choice_z | correct_answers | media_url |
 *   sub_1_question | sub_1_answers | sub_1_points … sub_20_* (SUB_QUESTIONS_TEXT) |
 *   choice_a_image … choice_z_image (picture choices) | show_on_phones |
 *   pack_time_limit_sec | media_type | time_limit_sec | base_points |
 *   multi_scoring | fuzzy | max_typos | explanation | order
 *
 * lib/bank/export.ts writes these same columns, so an exported pack imports back unchanged.
 */
import { CHOICE_LETTERS, MAX_SUB_QUESTIONS, type BankQuestion, type Choice, type ChoiceId, type QuestionType, type SubQuestion } from "@/lib/game/types";
import type { ImportDoc, ImportPack } from "./types";

export type Row = Record<string, unknown>;

export interface RowsResult {
  doc: ImportDoc;
  /** Spreadsheet row number (1-based, header = row 1) for each doc.questions[i]. */
  rowOf: number[];
  problems: { row: number; message: string }[];
}

const LETTERS: ChoiceId[] = CHOICE_LETTERS;

const HEADER_ALIASES: Record<string, string> = {
  pack: "quiz_pack_id",
  pack_id: "quiz_pack_id",
  quiz_pack: "quiz_pack_id",
  quiz_pack_id: "quiz_pack_id",
  pack_name: "pack_title",
  pack_title: "pack_title",
  pack_description: "pack_description",
  id: "question_id",
  question_id: "question_id",
  type: "type",
  question_type: "type",
  question: "question_text",
  question_text: "question_text",
  text: "question_text",
  answer: "correct_answers",
  answers: "correct_answers",
  correct: "correct_answers",
  correct_answer: "correct_answers",
  correct_answers: "correct_answers",
  correct_answers_array: "correct_answers",
  media: "media_url",
  media_url: "media_url",
  image: "media_url",
  image_url: "media_url",
  media_type: "media_type",
  time: "time_limit_sec",
  time_limit: "time_limit_sec",
  time_limit_sec: "time_limit_sec",
  seconds: "time_limit_sec",
  points: "base_points",
  base_points: "base_points",
  multi_scoring: "multi_scoring",
  scoring: "multi_scoring",
  fuzzy: "fuzzy",
  max_typos: "max_typos",
  typos: "max_typos",
  explanation: "explanation",
  fun_fact: "explanation",
  order: "order",
  position: "order",
  show_on_phones: "show_on_phones",
  show_media_on_player: "show_on_phones",
  pack_time_limit_sec: "pack_time_limit_sec",
  pack_time: "pack_time_limit_sec",
  default_time_limit_sec: "pack_time_limit_sec",
};

function headerKey(h: string): string | null {
  const k = h.trim().toLowerCase().replace(/[\s.-]+/g, "_").replace(/[^a-z0-9_]/g, "");
  // Sub-question columns: sub_1_question, sub_1_answers, sub_1_points (also "part_1_answer", "sub1_q", ...)
  const sq = k.match(/^(?:sub|part|sub_question|subq)_?(\d{1,2})(?:_?(question|prompt|q|answers?|a|points?|pts))?$/);
  if (sq) {
    const kind = !sq[2] || ["question", "prompt", "q"].includes(sq[2]) ? "question" : sq[2].startsWith("p") ? "points" : "answers";
    return `sub_${Number(sq[1])}_${kind}`;
  }
  // Picture for a choice: choice_a_image, option_b_picture, ...
  const pic = k.match(/^(?:choice|option|opt)_?([a-z])_?(?:image|img|picture|pic|media|media_url)$/);
  if (pic) return `choice_${pic[1]}_media`;
  const m = k.match(/^(?:choice|option|opt|answer_option)_?([a-z])$/);
  if (m) return `choice_${m[1]}`;
  if (/^[a-z]$/.test(k)) return `choice_${k}`;
  return HEADER_ALIASES[k] ?? null;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function num(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: unknown): boolean | undefined {
  const s = str(v).toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return undefined;
}

/** Ids the database accepts as they are (see supabase/setup.sql). Kept unchanged so re-imports update in place. */
const VALID_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/;
function keepOrSlug(s: string): string {
  return VALID_ID.test(s) ? s : slugify(s);
}

export function slugify(s: string): string {
  const slug = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (slug.length >= 3) return slug;
  if (slug) return `${slug}-pack`;
  // Titles in Thai (or any non-Latin script) have no Latin letters to build an id from.
  return s.trim() ? `pack-${shortHash(s.trim())}` : "";
}

/** Short stable hash, so re-importing the same question updates it rather than duplicating it. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, "0");
}

function parseType(raw: string, hasChoices: boolean, correctCount: number, hasSubs = false): QuestionType | null {
  const t = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (!t) return hasSubs && !hasChoices ? "SUB_QUESTIONS_TEXT" : hasChoices ? (correctCount > 1 ? "MCQ_MULTI" : "MCQ_SINGLE") : "TEXT_INPUT";
  if (["sub_questions_text", "sub_questions", "sub", "subs", "multi_part", "parts", "sub_question"].includes(t)) return "SUB_QUESTIONS_TEXT";
  if (["mcq_single", "mcq", "single", "multiple_choice", "choice", "single_choice", "mc"].includes(t)) return "MCQ_SINGLE";
  if (["mcq_multi", "multi", "multiple", "multi_choice", "multiple_answer", "multi_select", "checkbox"].includes(t)) return "MCQ_MULTI";
  if (["text_input", "text", "short", "short_answer", "open", "input", "free_text"].includes(t)) return "TEXT_INPUT";
  return null;
}

function inferMediaType(url: string): "image" | "audio" | "video" | undefined {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(path)) return "image";
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(path)) return "audio";
  if (/\.(mp4|webm|mov|m4v)$/.test(path)) return "video";
  return undefined;
}

export function rowsToImport(rows: Row[]): RowsResult {
  const packs = new Map<string, ImportPack>();
  const questions: BankQuestion[] = [];
  const rowOf: number[] = [];
  const problems: RowsResult["problems"] = [];
  const usedIds = new Set<string>();
  let lastPackId = "";

  rows.forEach((raw, i) => {
    const rowNo = i + 2; // header is row 1
    const r: Record<string, unknown> = {};
    for (const [h, v] of Object.entries(raw)) {
      const key = headerKey(h);
      if (key && r[key] === undefined) r[key] = v;
    }

    const text = str(r.question_text);
    const anyValue = Object.values(r).some((v) => str(v) !== "");
    if (!anyValue) return; // blank line
    if (!text) {
      problems.push({ row: rowNo, message: "missing question text" });
      return;
    }

    // Pack: explicit id, else slug of title, else carry over from the row above.
    const packTitle = str(r.pack_title);
    let packId = str(r.quiz_pack_id) ? keepOrSlug(str(r.quiz_pack_id)) : packTitle ? slugify(packTitle) : lastPackId;
    if (!packId) {
      problems.push({ row: rowNo, message: "no quiz pack — fill in quiz_pack_id or pack_title" });
      return;
    }
    lastPackId = packId;
    if (!packs.has(packId)) {
      const packTime = num(r.pack_time_limit_sec);
      packs.set(packId, {
        quiz_pack_id: packId,
        title: packTitle || str(r.quiz_pack_id) || packId,
        ...(str(r.pack_description) ? { description: str(r.pack_description) } : {}),
        ...(packTime !== undefined ? { default_time_limit_sec: Math.round(packTime) } : {}),
      });
    } else if (packTitle && packs.get(packId)!.title === packId) {
      packs.get(packId)!.title = packTitle;
    }

    // Choices
    const choices: Choice[] = [];
    for (const L of LETTERS) {
      const v = str(r[`choice_${L.toLowerCase()}`]);
      const media = str(r[`choice_${L.toLowerCase()}_media`]);
      if (v || media) choices.push({ choice_id: L, text: v, ...(media ? { media_url: media } : {}) });
    }

    // Correct answers
    const correctRaw = str(r.correct_answers);
    let correct: string[];
    if (choices.length) {
      const parts = correctRaw.split(/\s*[|,;]\s*/).filter(Boolean);
      correct = parts.map((p) => {
        const up = p.toUpperCase();
        if (/^[A-Z]$/.test(up) && choices.some((c) => c.choice_id === up)) return up;
        // Allow the answer to be written as the choice text, e.g. "Saturn".
        const byText = choices.find((c) => c.text.toLowerCase() === p.toLowerCase());
        return byText ? byText.choice_id : p;
      });
    } else {
      correct = correctRaw.split(/\s*\|\s*/).filter(Boolean);
    }
    correct = [...new Set(correct)];

    // Sub-questions (parts): sub_1_question / sub_1_answers / sub_1_points, up to 20
    const subs: SubQuestion[] = [];
    for (let n = 1; n <= MAX_SUB_QUESTIONS; n++) {
      const prompt = str(r[`sub_${n}_question`]);
      const answers = str(r[`sub_${n}_answers`]).split(/\s*\|\s*/).filter(Boolean);
      if (!prompt && answers.length === 0) continue;
      const sqObj: SubQuestion = { sub_id: String(n), prompt, correct_answers_array: [...new Set(answers)] };
      const pts = num(r[`sub_${n}_points`]);
      if (pts !== undefined) sqObj.points = Math.round(pts);
      subs.push(sqObj);
    }

    const type = parseType(str(r.type), choices.length > 0, correct.length, subs.length > 0);
    if (!type) {
      problems.push({ row: rowNo, message: `unknown type "${str(r.type)}" — use MCQ_SINGLE, MCQ_MULTI, TEXT_INPUT or SUB_QUESTIONS_TEXT` });
      return;
    }
    if (type === "SUB_QUESTIONS_TEXT") correct = [];

    let qid = str(r.question_id) ? keepOrSlug(str(r.question_id)) : `${packId.slice(0, 40)}-${shortHash(text)}`;
    if (usedIds.has(qid) && !str(r.question_id)) qid = `${qid}-${rowNo}`;
    usedIds.add(qid);

    const q: BankQuestion = {
      question_id: qid,
      quiz_pack_id: packId,
      type,
      question_text: text,
      correct_answers_array: correct,
    };
    if (type === "MCQ_SINGLE" || type === "MCQ_MULTI") q.choices = choices;
    if (type === "SUB_QUESTIONS_TEXT") q.sub_questions = subs;

    const media = str(r.media_url);
    if (media) {
      q.media_url = media;
      const mt = str(r.media_type).toLowerCase() || inferMediaType(media);
      if (mt) q.media_type = mt as "image" | "audio" | "video";
      const phones = bool(r.show_on_phones);
      if (phones !== undefined) q.show_media_on_player = phones;
    }
    const time = num(r.time_limit_sec);
    if (time !== undefined) q.time_limit_sec = Math.round(time);
    const pts = num(r.base_points);
    if (pts !== undefined) q.base_points = Math.round(pts);
    const order = num(r.order);
    if (order !== undefined) q.order = Math.round(order);
    const expl = str(r.explanation);
    if (expl) q.explanation = expl;

    if (type === "MCQ_MULTI") {
      const ms = str(r.multi_scoring).toLowerCase();
      if (ms) q.multi_scoring = ms.startsWith("all") ? "ALL_OR_NOTHING" : "PARTIAL";
    }
    if (type === "TEXT_INPUT" || type === "SUB_QUESTIONS_TEXT") {
      const fuzzy = bool(r.fuzzy);
      const typos = num(r.max_typos);
      if (fuzzy !== undefined || typos !== undefined) {
        q.text_matching = {};
        if (fuzzy !== undefined) q.text_matching.fuzzy = fuzzy;
        if (typos !== undefined) q.text_matching.max_typos = Math.max(0, Math.min(2, Math.round(typos))) as 0 | 1 | 2;
      }
    }

    questions.push(q);
    rowOf.push(rowNo);
  });

  return { doc: { schema_version: 1, quiz_packs: [...packs.values()], questions }, rowOf, problems };
}

/** Accepts either an ImportDoc or a bare array of questions. */
export function normalizeJsonImport(data: unknown): ImportDoc {
  if (Array.isArray(data)) {
    // Packs are created on the server if they don't exist yet.
    return { schema_version: 1, quiz_packs: [], questions: data as BankQuestion[] };
  }
  const d = (data ?? {}) as Partial<ImportDoc>;
  return { ...d, schema_version: 1, quiz_packs: d.quiz_packs ?? [], questions: d.questions ?? [] } as ImportDoc;
}
