/**
 * Host review: before the answer is revealed, the host sees every answer that
 * has come in, grouped so that identical answers share one decision, and can
 * mark a group right or wrong by hand. Pure functions, so the same grouping is
 * used for the review screen, for validating a change, and in tests.
 */
import { isChoiceType, isSequenceType, type BankQuestion, type Submission, type Team } from "./types";
import { choiceKey, explainTextMatch, textKey, type MarkOverride, type Overrides, type TextMatch, type Verdict } from "./scoring";
import { describeSequence, markSequence, sequenceLength, sequenceReviewKey } from "./sequence";

export interface ReviewGroup {
  key: string;
  /** Sub-questions: which part (0-based). null for the whole question. */
  part: number | null;
  /** Typed answers: the most common spelling. Choices: "B · Canberra". */
  label: string;
  /** Other spellings in the same group (typed answers only). */
  variants: string[];
  team_names: string[];
  count: number;
  /** How the system marks it on its own. */
  auto: Verdict;
  /** Why, in words: "Exact match", "Accepted with 1 typo (Bangkok)", "In the answer key"… */
  auto_note: string;
  /** The host's decision, if any. */
  override: Verdict | null;
  /** What will count at the reveal. */
  final: Verdict;
  /** Accepted only thanks to the typo allowance: worth a second look. */
  typo: boolean;
  /**
   * Ordering / matching: the share of the points this answer gets on its own
   * (e.g. 0.75 for 3 of 4 in place), when that is more than nothing but less
   * than full. Marking it Right gives full points; Wrong gives none.
   */
  partial?: number;
}

export interface ReviewPayload {
  question_index: number;
  question_id: string;
  type: BankQuestion["type"];
  groups: ReviewGroup[];
  /** Sub-questions: the part prompts, in order. */
  parts: string[] | null;
  /** Teams locked out by anti-cheat: their answers don't count and are not listed. */
  voided_teams: string[];
  answered: number;
  changes: number;
}

export function matchNote(m: TextMatch): string {
  switch (m.kind) {
    case "EXACT":
      return "Exact match";
    case "NORMALISED":
      return `Same as “${m.matched}” apart from capitals, accents or spacing`;
    case "TYPO":
      return `Accepted with ${m.typos} typo${m.typos === 1 ? "" : "s"} (matched “${m.matched}”)`;
    case "BLANK":
      return "Left blank";
    default:
      return "No accepted answer matched";
  }
}

interface Acc {
  key: string;
  part: number | null;
  forms: Map<string, number>;
  teams: string[];
  match: TextMatch;
}

export function buildReview(
  q: BankQuestion,
  questionIndex: number,
  subs: Submission[],
  teams: Team[],
  overrides: Overrides,
): ReviewPayload {
  const name = new Map(teams.map((t) => [t.team_id, t.name]));
  const voided = new Set(teams.filter((t) => t.frozen_for_question === questionIndex).map((t) => t.team_id));
  const live = subs.filter((s) => !voided.has(s.team_id)).sort((a, b) => a.received_at - b.received_at);
  const ignoreArticles = q.text_matching?.ignore_articles ?? true;
  const groups: ReviewGroup[] = [];

  const finish = (key: string, part: number | null, label: string, variants: string[], teamIds: string[], auto: Verdict, note: string, typo: boolean, partial?: number) => {
    const o = overrides[key];
    groups.push({
      ...(partial !== undefined ? { partial } : {}),
      key,
      part,
      label,
      variants,
      team_names: teamIds.map((id) => name.get(id) ?? "?"),
      count: teamIds.length,
      auto,
      auto_note: note,
      override: o ? o.verdict : null,
      final: o ? o.verdict : auto,
      typo,
    });
  };

  if (isSequenceType(q.type)) {
    // Identical full answers share one decision.
    const n = sequenceLength(q);
    const all = q.multi_scoring === "ALL_OR_NOTHING";
    const byKey = new Map<string, { answer: string[]; teams: string[] }>();
    for (const s of live) {
      const k = sequenceReviewKey(s.answer);
      const g = byKey.get(k) ?? { answer: s.answer, teams: [] };
      g.teams.push(s.team_id);
      byKey.set(k, g);
    }
    for (const [k, g] of byKey) {
      const { hits } = markSequence(n, g.answer);
      const auto: Verdict = hits === n ? "CORRECT" : "WRONG";
      const share = hits > 0 && hits < n && !all ? hits / n : undefined;
      const what = q.type === "MATCHING" ? "matched correctly" : "in the right place";
      const note =
        hits === n ? "Exactly the answer key" : `${hits} of ${n} ${what}${share !== undefined ? ` (${Math.round(share * 100)}% of the points)` : all ? " (all-or-nothing: no points)" : ""}`;
      finish(k, null, describeSequence(q, g.answer), [], g.teams, auto, note, false, share);
    }
    const weight = (g: ReviewGroup) => (g.auto === "CORRECT" ? 2 : g.partial ? 1 : 0);
    groups.sort((a, b) => weight(b) - weight(a) || (b.partial ?? 0) - (a.partial ?? 0) || b.count - a.count);
  } else if (isChoiceType(q.type)) {
    const key = new Set(q.correct_answers_array);
    for (const c of q.choices ?? []) {
      const who = live.filter((s) => s.answer.includes(c.choice_id)).map((s) => s.team_id);
      const auto: Verdict = key.has(c.choice_id) ? "CORRECT" : "WRONG";
      finish(choiceKey(c.choice_id), null, `${c.choice_id} · ${c.text || "(picture)"}`, [], who, auto, auto === "CORRECT" ? "In the answer key" : "Not in the answer key", false);
    }
  } else {
    const byKey = new Map<string, Acc>();
    const add = (raw: string, part: number | null, accepted: string[], teamId: string) => {
      const text = raw.trim();
      if (!text) return;
      const k = textKey(text, part, ignoreArticles);
      if (k.endsWith(":")) return; // nothing usable after normalising (only punctuation)
      let g = byKey.get(k);
      if (!g) {
        g = { key: k, part, forms: new Map(), teams: [], match: explainTextMatch(text, { correct_answers_array: accepted, text_matching: q.text_matching }) };
        byKey.set(k, g);
      }
      g.forms.set(text, (g.forms.get(text) ?? 0) + 1);
      g.teams.push(teamId);
    };
    for (const s of live) {
      if (q.type === "TEXT_INPUT") add(s.answer[0] ?? "", null, q.correct_answers_array, s.team_id);
      else (q.sub_questions ?? []).forEach((sq, i) => add(s.answer[i] ?? "", i, sq.correct_answers_array, s.team_id));
    }
    for (const g of byKey.values()) {
      // Most common spelling first; on a tie, the one that arrived first (Map keeps arrival order).
      const forms = [...g.forms.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
      const auto: Verdict = g.match.kind === "NONE" || g.match.kind === "BLANK" ? "WRONG" : "CORRECT";
      finish(g.key, g.part, forms[0], forms.slice(1), g.teams, auto, matchNote(g.match), g.match.kind === "TYPO");
    }
    // The ones worth a look first: not accepted, then typo-accepted; biggest groups first.
    const weight = (g: ReviewGroup) => (g.auto === "WRONG" ? 0 : g.typo ? 1 : 2);
    groups.sort((a, b) => (a.part ?? 0) - (b.part ?? 0) || weight(a) - weight(b) || b.count - a.count || a.label.localeCompare(b.label));
  }

  return {
    question_index: questionIndex,
    question_id: q.question_id,
    type: q.type,
    groups,
    parts: q.type === "SUB_QUESTIONS_TEXT" ? (q.sub_questions ?? []).map((sq) => sq.prompt) : null,
    voided_teams: teams.filter((t) => voided.has(t.team_id)).map((t) => t.name),
    answered: live.length,
    changes: Object.keys(overrides).length,
  };
}

/**
 * Checks a key sent by the host against the question. Typed-answer keys must
 * match an answer that has actually arrived, so the host can only rule on
 * real answers. Returns the group it refers to.
 */
export function findGroup(review: ReviewPayload, key: string): ReviewGroup | null {
  return review.groups.find((g) => g.key === key) ?? null;
}

export function toOverride(group: ReviewGroup, verdict: Verdict, at: number): MarkOverride {
  return { key: group.key, verdict, label: group.label, part: group.part, auto: group.auto, at };
}
