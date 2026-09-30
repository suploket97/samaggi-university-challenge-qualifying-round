/**
 * Server-side validation of a question bank import: JSON Schema first, then
 * the checks a schema can't express (duplicate ids, answer letters that
 * aren't among the choices, unknown packs).
 */
import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject } from "ajv";
import schema from "@/schemas/question-bank.schema.json";
import type { ImportDoc, ImportIssue } from "./types";
import { CHOICE_LETTERS } from "@/lib/game/types";

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addFormat("uri-reference", /^(https?:\/\/\S+|\/\S*)$/i);
const validateSchema = ajv.compile(schema as object);

function describe(e: ErrorObject): string {
  const field = e.instancePath.split("/").slice(3).join(".") || "question";
  const part = e.instancePath.match(/\/sub_questions\/(\d+)(?:\/(\w+))?/);
  if (part) {
    const n = Number(part[1]) + 1;
    if (e.keyword === "required") return `part ${n} is missing its ${(e.params as { missingProperty: string }).missingProperty === "prompt" ? "question" : "answer"}`;
    if (part[2] === "prompt") return `part ${n} needs a question (up to 500 characters)`;
    if (part[2] === "correct_answers_array") return `part ${n} needs at least one accepted answer`;
    if (part[2] === "points") return `part ${n} points must be a whole number from 0 to 1000`;
    if (part[2] === "sub_id") return `part ${n} has an invalid id (letters, numbers, - or _)`;
  }
  if (e.instancePath.endsWith("/sub_questions")) {
    if (e.keyword === "minItems") return "add at least one part";
    if (e.keyword === "maxItems") return "a question can have at most 20 parts";
    if (e.keyword === "false schema") return "only “sub-questions” questions can have parts";
  }
  if (e.keyword === "required" && (e.params as { missingProperty: string }).missingProperty === "sub_questions") return "add at least one part";
  // Matching pairs
  const pair = e.instancePath.match(/\/pairs\/(\d+)(?:\/(left|right))?/);
  if (pair) return `pair ${Number(pair[1]) + 1} needs both sides filled in (up to 200 characters each)`;
  if (e.instancePath.endsWith("/pairs")) {
    if (e.keyword === "minItems") return "a matching question needs at least 2 pairs";
    if (e.keyword === "maxItems") return "a matching question can have at most 10 pairs";
    if (e.keyword === "false schema") return "only matching questions can have pairs";
  }
  if (e.keyword === "required" && (e.params as { missingProperty: string }).missingProperty === "pairs") return "add at least 2 pairs";
  // An empty choice trips three rules at once (text length, media_url, anyOf); report it once, plainly.
  const choice = e.instancePath.match(/\/choices\/(\d+)(\/text)?$/);
  if (choice && ["minLength", "required", "anyOf"].includes(e.keyword)) {
    return `choice ${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Number(choice[1])] ?? Number(choice[1]) + 1} needs text or a picture`;
  }
  switch (e.keyword) {
    case "required":
      return `missing ${(e.params as { missingProperty: string }).missingProperty}`;
    case "additionalProperties":
      return `unknown field "${(e.params as { additionalProperty: string }).additionalProperty}"`;
    case "enum":
      return `${field} must be one of ${(e.params as { allowedValues: unknown[] }).allowedValues.join(", ")}`;
    case "pattern":
      if (field.startsWith("correct_answers_array")) return "MCQ answers must be choice letters A–Z";
      if (field === "question_id" || field === "quiz_pack_id")
        return `${field} must be 3–64 lowercase letters, numbers, - or _`;
      return `${field} has an invalid format`;
    case "maxItems":
      if (field === "correct_answers_array") return "single-choice and true/false questions must have exactly one correct answer";
      if (field === "choices") {
        const lim = (e.params as { limit: number }).limit;
        return lim === 2 ? "true/false questions have exactly 2 choices (true and false)" : lim === 10 ? "an ordering question can have at most 10 items" : "a question can have at most 26 choices (A–Z)";
      }
      return `${field} has too many items`;
    case "minItems":
      return field === "choices" ? "this question type needs at least 2 choices (or items)" : `${field} needs at least one value`;
    case "not":
      return "text questions must not have choices";
    case "false schema":
      return `${field} is not allowed for this question type`;
    case "format":
      return `${field} must be a full https:// URL or a path starting with /`;
    case "if":
      return ""; // the specific branch error is reported separately
    default:
      return `${field} ${e.message ?? "is invalid"}`;
  }
}

export function validateImport(input: unknown): { doc: ImportDoc | null; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];

  if (!validateSchema(input)) {
    const seen = new Set<string>();
    for (const e of validateSchema.errors ?? []) {
      const m = e.instancePath.match(/^\/questions\/(\d+)/);
      const qi = m ? Number(m[1]) : null;
      const message = describe(e);
      if (!message) continue;
      const key = `${qi}:${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ question_index: qi, message: qi === null ? `${e.instancePath || "file"}: ${message}` : message });
    }
    return { doc: null, issues };
  }

  const doc = input as ImportDoc;
  const ids = new Map<string, number>();
  doc.questions.forEach((q, i) => {
    const prev = ids.get(q.question_id);
    if (prev !== undefined) issues.push({ question_index: i, message: `duplicate question_id "${q.question_id}" (also used by question ${prev + 1})` });
    ids.set(q.question_id, i);

    if (q.type === "TRUE_FALSE") {
      for (const a of q.correct_answers_array) {
        if (a !== "A" && a !== "B") issues.push({ question_index: i, message: `true/false answer must be A (true) or B (false), not "${a}"` });
      }
    }
    if (q.type === "ORDERING") {
      // The key is the written order; letters are filled in A, B, C… so gaps don't matter.
      q.choices = (q.choices ?? []).map((c, j) => ({ ...c, choice_id: CHOICE_LETTERS[j] }));
      q.correct_answers_array = q.choices.map((c) => c.choice_id);
      (q.choices ?? []).forEach((c) => {
        if (!c.text?.trim() && !c.media_url) issues.push({ question_index: i, message: `item ${c.choice_id} needs text or a picture` });
      });
      const texts = (q.choices ?? []).filter((c) => !c.media_url).map((c) => c.text.trim().toLowerCase());
      if (new Set(texts).size !== texts.length) issues.push({ question_index: i, message: "two items have the same text, so the order would be ambiguous" });
    }
    if (q.type === "MATCHING") {
      q.correct_answers_array = CHOICE_LETTERS.slice(0, (q.pairs ?? []).length);
      const lefts = (q.pairs ?? []).map((p) => p.left.trim().toLowerCase());
      const rights = (q.pairs ?? []).map((p) => p.right.trim().toLowerCase());
      if (new Set(lefts).size !== lefts.length) issues.push({ question_index: i, message: "two pairs have the same left-hand side" });
      if (new Set(rights).size !== rights.length) issues.push({ question_index: i, message: "two pairs have the same right-hand side, so the matches would be ambiguous" });
    }
    if (q.type === "MCQ_SINGLE" || q.type === "MCQ_MULTI" || q.type === "TRUE_FALSE") {
      const letters = new Set((q.choices ?? []).map((c) => c.choice_id));
      if (letters.size !== (q.choices ?? []).length) issues.push({ question_index: i, message: "two choices share the same letter" });
      (q.choices ?? []).forEach((c) => {
        if (!c.text?.trim() && !c.media_url) issues.push({ question_index: i, message: `choice ${c.choice_id} needs text or a picture` });
      });
      for (const a of q.correct_answers_array) {
        if (!letters.has(a as never)) issues.push({ question_index: i, message: `correct answer "${a}" is not one of the choices` });
      }
    }
    if (q.type === "SUB_QUESTIONS_TEXT") {
      const ids = new Set<string>();
      (q.sub_questions ?? []).forEach((sq, j) => {
        if (ids.has(sq.sub_id)) issues.push({ question_index: i, message: `part ${j + 1} reuses the id "${sq.sub_id}"` });
        ids.add(sq.sub_id);
      });
    }
    if (q.media_url && !q.media_type) issues.push({ question_index: i, message: "media_url needs a media_type (image, audio or video)" });
  });

  const packIds = new Set<string>();
  for (const p of doc.quiz_packs) {
    if (packIds.has(p.quiz_pack_id)) issues.push({ question_index: null, message: `pack "${p.quiz_pack_id}" is listed twice` });
    packIds.add(p.quiz_pack_id);
  }

  return { doc: issues.length ? null : doc, issues };
}

/** Pack ids that questions refer to but that aren't defined in the file. */
export function referencedPacksNotInFile(doc: ImportDoc): string[] {
  const inFile = new Set(doc.quiz_packs.map((p) => p.quiz_pack_id));
  return [...new Set(doc.questions.map((q) => q.quiz_pack_id))].filter((id) => !inFile.has(id));
}
