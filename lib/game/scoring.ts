/**
 * Evaluation pipeline. Pure functions, no I/O — easy to unit-test and safe to
 * run in a Vercel function at reveal time over hundreds of submissions.
 */
import type {
  BankQuestion,
  QuestionResult,
  ScoreRow,
  SpeedTier,
  Submission,
  Team,
} from "./types";

export const DEFAULT_BASE_POINTS = 100;
export const DEFAULT_SPEED_TIERS: SpeedTier[] = [
  { within_sec: 5, bonus: 20 },
  { within_sec: 10, bonus: 10 },
];

// ---------------------------------------------------------------------------
// Text normalisation + fuzzy match
// ---------------------------------------------------------------------------

const ARTICLES = /^(the|a|an)\s+/;

export function normalizeAnswer(raw: string, ignoreArticles = true): string {
  let s = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip Latin accents: "Pelé" -> "Pele"
    .replace(/[\u0e50-\u0e59]/g, (d) => String(d.charCodeAt(0) - 0x0e50)) // Thai digits ๑๙๘๙ -> 1989
    .toLowerCase()
    .replace(/&/g, " and ")
    // Drop symbols and punctuation but keep letters, digits AND combining marks in
    // any script: Thai vowel and tone marks change the word (ไก่ chicken, ไก่ ≠ ไก).
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (ignoreArticles) s = s.replace(ARTICLES, "");
  return s;
}

/** Levenshtein with an early exit once the distance exceeds `max`. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * How many typos to allow for a given accepted answer. Short answers get none,
 * otherwise "cat" would accept "car" and "Mars" would accept "Mary".
 */
export function allowedTypos(normalizedAlias: string, maxTypos: number): number {
  if (/^[\d\s]+$/.test(normalizedAlias)) return 0; // years, counts: exact only
  const len = normalizedAlias.replace(/\s/g, "").length;
  if (len <= 4) return 0;
  if (len <= 8) return Math.min(1, maxTypos);
  return Math.min(2, maxTypos);
}

/**
 * Why a typed answer was (or wasn't) accepted. Kept for the competition log,
 * so a disputed answer can be explained exactly.
 *   EXACT      typed exactly as an accepted answer
 *   NORMALISED same after ignoring capitals, accents, punctuation, spaces or a leading "the/a/an"
 *   TYPO       within the allowed number of typos (typos = edit distance)
 *   NONE       no accepted answer matched
 *   BLANK      nothing (usable) was typed
 */
export interface TextMatch {
  kind: "EXACT" | "NORMALISED" | "TYPO" | "NONE" | "BLANK";
  matched?: string;
  typos?: number;
}

export function explainTextMatch(raw: string, q: Pick<BankQuestion, "correct_answers_array" | "text_matching">): TextMatch {
  const opts = q.text_matching ?? {};
  const ignoreArticles = opts.ignore_articles ?? true;
  const fuzzy = opts.fuzzy ?? true;
  const maxTypos = opts.max_typos ?? 2;

  const given = normalizeAnswer(raw, ignoreArticles);
  if (!given) return { kind: "BLANK" };

  // Prefer the closest explanation: exact, then normalised, then typo.
  for (const alias of q.correct_answers_array) {
    if (raw.trim() === alias.trim()) return { kind: "EXACT", matched: alias };
  }
  for (const alias of q.correct_answers_array) {
    const target = normalizeAnswer(alias, ignoreArticles);
    // Also compare with spaces removed: "new york" vs "newyork".
    if (given === target || given.replace(/ /g, "") === target.replace(/ /g, "")) return { kind: "NORMALISED", matched: alias };
  }
  if (fuzzy) {
    for (const alias of q.correct_answers_array) {
      const target = normalizeAnswer(alias, ignoreArticles);
      const k = allowedTypos(target, maxTypos);
      if (k > 0) {
        const d = levenshtein(given, target, k);
        if (d <= k) return { kind: "TYPO", matched: alias, typos: d };
      }
    }
  }
  return { kind: "NONE" };
}

export function matchTextAnswer(raw: string, q: BankQuestion): boolean {
  const k = explainTextMatch(raw, q).kind;
  return k === "EXACT" || k === "NORMALISED" || k === "TYPO";
}

export function speedBonus(elapsedMs: number, tiers: SpeedTier[]): number {
  const sorted = [...tiers].sort((a, b) => a.within_sec - b.within_sec);
  for (const t of sorted) if (elapsedMs <= t.within_sec * 1000) return t.bonus;
  return 0;
}

/** Fraction of credit (0..1) for an answer, before points are applied. */
export function answerFraction(q: BankQuestion, answer: string[]): number {
  switch (q.type) {
    case "MCQ_SINGLE":
      return answer.length === 1 && answer[0] === q.correct_answers_array[0] ? 1 : 0;

    case "MCQ_MULTI": {
      const correct = new Set(q.correct_answers_array);
      const picked = new Set(answer);
      if (picked.size === 0) return 0;
      const exact = picked.size === correct.size && [...picked].every((c) => correct.has(c));
      if (exact) return 1;
      if ((q.multi_scoring ?? "PARTIAL") === "ALL_OR_NOTHING") return 0;
      // +1/k per correct pick, -1/k per wrong pick, floored at 0. Stops
      // "select everything" from being a winning strategy.
      const k = correct.size;
      let hits = 0;
      let misses = 0;
      for (const c of picked) (correct.has(c) ? hits++ : misses++);
      return Math.max(0, (hits - misses) / k);
    }

    case "TEXT_INPUT":
      return answer.length > 0 && matchTextAnswer(answer[0], q) ? 1 : 0;

    case "SUB_QUESTIONS_TEXT": {
      const { earned, total } = markSubQuestions(q, answer, DEFAULT_BASE_POINTS);
      return total > 0 ? earned / total : 0;
    }
  }
}

// ---------------------------------------------------------------------------
// SUB_QUESTIONS_TEXT
// ---------------------------------------------------------------------------

/**
 * Points for each part: a part's own `points` if set, otherwise the
 * question's base points split evenly (any remainder goes to the first parts).
 */
export function subQuestionPoints(q: BankQuestion, base: number): number[] {
  const subs = q.sub_questions ?? [];
  const n = subs.length;
  if (n === 0) return [];
  const even = Math.floor(base / n);
  const extra = base - even * n;
  return subs.map((s, i) => (typeof s.points === "number" ? s.points : even + (i < extra ? 1 : 0)));
}

/**
 * Marks every part on its own (same typo, accent and Thai rules as a typed
 * answer) and sums the points of the parts answered correctly.
 */
export function markSubQuestions(q: BankQuestion, answer: string[], base: number) {
  const subs = q.sub_questions ?? [];
  const points = subQuestionPoints(q, base);
  const correct = subs.map((s, i) => {
    const given = (answer[i] ?? "").trim();
    return given !== "" && matchTextAnswer(given, { ...q, correct_answers_array: s.correct_answers_array });
  });
  const earned = correct.reduce((t, ok, i) => t + (ok ? points[i] : 0), 0);
  const total = points.reduce((a, b) => a + b, 0);
  return { correct, points, earned, total };
}

export function scoreSubmission(
  q: BankQuestion,
  team_id: string,
  sub: Submission | undefined,
  questionStartedAt: number,
  voided: boolean,
  packDefaults: { base_points?: number; speed_tiers?: SpeedTier[] } = {},
): QuestionResult {
  const base = q.base_points ?? packDefaults.base_points ?? DEFAULT_BASE_POINTS;
  const tiers = q.speed_tiers ?? packDefaults.speed_tiers ?? DEFAULT_SPEED_TIERS;

  const isSub = q.type === "SUB_QUESTIONS_TEXT";

  if (!sub || voided) {
    return {
      team_id,
      correct: false,
      fraction: 0,
      base_points: 0,
      speed_bonus: 0,
      points: 0,
      answered: !!sub,
      elapsed_ms: sub ? sub.received_at - questionStartedAt : null,
      voided_by_anti_cheat: voided && !!sub,
      ...(isSub ? { sub_correct: (q.sub_questions ?? []).map(() => false) } : {}),
    };
  }

  const elapsed = Math.max(0, sub.received_at - questionStartedAt);

  if (isSub) {
    // One total for the question: the sum of the parts answered correctly.
    const m = markSubQuestions(q, sub.answer, base);
    const allRight = m.correct.length > 0 && m.correct.every(Boolean);
    const bonus = allRight ? speedBonus(elapsed, tiers) : 0; // bonus only when every part is right
    return {
      team_id,
      correct: allRight,
      fraction: m.total > 0 ? m.earned / m.total : 0,
      base_points: m.earned,
      speed_bonus: bonus,
      points: m.earned + bonus,
      answered: true,
      elapsed_ms: elapsed,
      voided_by_anti_cheat: false,
      sub_correct: m.correct,
    };
  }
  const fraction = answerFraction(q, sub.answer);
  const correct = fraction === 1;
  const basePts = Math.round(base * fraction);
  const bonus = correct ? speedBonus(elapsed, tiers) : 0; // bonus only for full marks

  return {
    team_id,
    correct,
    fraction,
    base_points: basePts,
    speed_bonus: bonus,
    points: basePts + bonus,
    answered: true,
    elapsed_ms: elapsed,
    voided_by_anti_cheat: false,
  };
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface Tally {
  score: number;
  correct_count: number;
  total_correct_time_ms: number;
}

/**
 * Ranks teams. Tie-break order: score desc, correct answers desc, total time
 * spent on correct answers asc, join time asc. Equal on all four = shared rank.
 */
export function rankTeams(
  teams: Team[],
  tallies: Record<string, Tally>,
  previous: ScoreRow[] = [],
): ScoreRow[] {
  const prevRank = new Map(previous.map((r) => [r.team_id, r.rank]));
  const prevScore = new Map(previous.map((r) => [r.team_id, r.score]));
  const rows = teams.map((t) => {
    const tally = tallies[t.team_id] ?? { score: 0, correct_count: 0, total_correct_time_ms: 0 };
    return { team: t, ...tally };
  });

  rows.sort(
    (a, b) =>
      b.score - a.score ||
      b.correct_count - a.correct_count ||
      a.total_correct_time_ms - b.total_correct_time_ms ||
      a.team.joined_at - b.team.joined_at,
  );

  const out: ScoreRow[] = [];
  rows.forEach((r, i) => {
    const prev = out[i - 1];
    const tied =
      prev &&
      prev.score === r.score &&
      prev.correct_count === r.correct_count &&
      prev.total_correct_time_ms === r.total_correct_time_ms;
    out.push({
      team_id: r.team.team_id,
      name: r.team.name,
      score: r.score,
      correct_count: r.correct_count,
      total_correct_time_ms: r.total_correct_time_ms,
      rank: tied ? prev.rank : i + 1,
      previous_rank: prevRank.get(r.team.team_id) ?? null,
      previous_score: prevScore.get(r.team.team_id) ?? null,
    });
  });
  return out;
}
