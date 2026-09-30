/**
 * Ordering and matching questions. Pure functions, shared by the engine,
 * scoring, the review screen and the tests.
 *
 * The author writes ordering items in the correct order (A first) and matching
 * pairs as left/right. Phones and the big screen must not be able to work the
 * answer out, so the items (or the right-hand side) are shuffled and relabelled
 * with display letters: A = the first one shown. The shuffle depends on a
 * secret seed kept only on the server (RoomState.secret_seed), so even with
 * the source code the display order can't be traced back to the answer.
 *
 * Answers are converted to the question's own ids as they arrive, so from then
 * on (scoring, review, log) the key is simply A, B, C… in order.
 */
import { CHOICE_LETTERS, type BankQuestion, type Choice, type ChoiceId, type PublicQuestion } from "./types";

/** FNV-1a: a small, stable string hash. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded random number generator. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The display order: shown[i] = the question's own index of the item shown in
 * position i. Never the correct order itself (that would give the answer away).
 */
export function displayOrder(n: number, seed: string, questionId: string): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  const next = rng(hash(`${seed}:${questionId}`));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (n >= 2 && order.every((v, i) => v === i)) order.push(order.shift()!); // rotate by one
  return order;
}

/** How many items: ORDERING = choices, MATCHING = pairs. */
export function sequenceLength(q: Pick<BankQuestion, "type" | "choices" | "pairs">): number {
  return q.type === "MATCHING" ? (q.pairs ?? []).length : (q.choices ?? []).length;
}

/** The answer key in the question's own ids: A, B, C… */
export function sequenceKey(n: number): string[] {
  return CHOICE_LETTERS.slice(0, n);
}

/** The items as the author wrote them: ORDERING items, or MATCHING right-hand sides. */
function ownItems(q: Pick<BankQuestion, "type" | "choices" | "pairs">): Choice[] {
  if (q.type === "MATCHING") return (q.pairs ?? []).map((p, i) => ({ choice_id: CHOICE_LETTERS[i], text: p.right }));
  return (q.choices ?? []).map((c, i) => ({ ...c, choice_id: CHOICE_LETTERS[i] }));
}

/** What the screens get: shuffled items with display letters, plus the matching left side. */
export function publicSequence(q: BankQuestion, seed: string): Pick<PublicQuestion, "choices" | "match_left"> {
  const items = ownItems(q);
  const order = displayOrder(items.length, seed, q.question_id);
  return {
    choices: order.map((own, i) => ({ ...items[own], choice_id: CHOICE_LETTERS[i] })),
    match_left: q.type === "MATCHING" ? (q.pairs ?? []).map((p) => p.left) : null,
  };
}

/** Display letters from a phone → the question's own ids. "" (blank) stays "". */
export function toOwnIds(answer: string[], n: number, seed: string, questionId: string): string[] {
  const order = displayOrder(n, seed, questionId);
  return answer.map((a) => (a === "" ? "" : CHOICE_LETTERS[order[CHOICE_LETTERS.indexOf(a as ChoiceId)]]));
}

/** The question's own ids → display letters (to show a team its own answer again after a reconnect). */
export function toDisplayIds(answer: string[], n: number, seed: string, questionId: string): string[] {
  const order = displayOrder(n, seed, questionId);
  return answer.map((a) => (a === "" ? "" : CHOICE_LETTERS[order.indexOf(CHOICE_LETTERS.indexOf(a as ChoiceId))]));
}

/** Which positions are right. `answer` is in the question's own ids. */
export function markSequence(n: number, answer: string[]) {
  const key = sequenceKey(n);
  const correct = key.map((k, i) => answer[i] === k);
  return { correct, hits: correct.filter(Boolean).length, n };
}

/** Review key: identical full answers share one decision. */
export function sequenceReviewKey(answer: string[]): string {
  return `s:${answer.map((a) => a || "-").join(",")}`;
}

/** Readable text of an answer in the question's own ids, e.g. "Rome → Paris → Berlin" or "1 Thailand → Bangkok · 2 Japan → —". */
export function describeSequence(q: Pick<BankQuestion, "type" | "choices" | "pairs">, answer: string[]): string {
  const items = ownItems(q);
  const text = (id: string) => {
    if (!id) return "—";
    const it = items[CHOICE_LETTERS.indexOf(id as ChoiceId)];
    return it ? it.text || `(picture ${id})` : id;
  };
  if (q.type === "MATCHING") return (q.pairs ?? []).map((p, i) => `${i + 1} ${p.left} → ${text(answer[i] ?? "")}`).join(" · ");
  return answer.map(text).join(" → ");
}

/** The correct answer as text: the items in order, or each pair. */
export function describeSequenceKey(q: Pick<BankQuestion, "type" | "choices" | "pairs">): string {
  return describeSequence(q, sequenceKey(sequenceLength(q)));
}
