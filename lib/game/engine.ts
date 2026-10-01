/**
 * GameEngine: the Game State Manager. The only code allowed to change a room.
 *
 * Called from Next.js route handlers / server actions:
 *   /api/rooms                      POST   createRoom            (admin)
 *   /api/rooms/[code]/command       POST   dispatch(cmd)         (admin)
 *   /api/rooms/[code]/tick          POST   tick()                (any client; idempotent)
 *   /api/rooms/[code]/join          POST   joinTeam              (player)
 *   /api/rooms/[code]/answer        POST   submitAnswer          (player, hot path)
 *   /api/rooms/[code]/focus         POST   reportFocusLoss       (player)
 *   /api/rooms/[code]/me            GET    getPlayerContext      (player, reconnect)
 *
 * Sync model: the server is the single writer. After each transition it
 * broadcasts a public snapshot (no answers until REVEAL) on the realtime
 * channel `room:{code}`. /stage, /admin and /play all subscribe to the same
 * channel and each renders its own projection (see projections.ts). Clients
 * drop any snapshot whose `version` is not newer than the one they hold.
 *
 * Timer: the server stores started_at / ends_at and never "ticks". Clients
 * render the countdown locally. When time is up, any client may POST /tick;
 * the state machine refuses it until the server clock agrees, so it is safe
 * to call from every screen (the first one wins, the rest get a no-op).
 */
import type {
  AdminCommand,
  BankQuestion,
  PublicQuestion,
  QualificationPayload,
  QuestionResultRecord,
  RevealPayload,
  RoomSettings,
  RoomState,
  ScoreRow,
  SpeedTier,
  Submission,
  Team,
} from "./types";
import { SCORING_MODES, isChoiceType, isSequenceType } from "./types";
import { describeSequence, markSequence, publicSequence, sequenceKey, sequenceLength, toDisplayIds, toOwnIds } from "./sequence";
import { GameError, assertCanApply, createInitialState, isAcceptingAnswers, transition } from "./state-machine";
import type { ResolvedEvent } from "./state-machine";
import { cutTieBreak, effectiveChoiceKey, qualifiedIds, rankTeams, scoreSubmission, subQuestionPoints } from "./scoring";
import type { MarkOverride, Tally, Verdict } from "./scoring";
import { buildReview, findGroup, toOverride, type ReviewPayload } from "./review";
import type { RoomStore } from "./store";
import { explainAnswer, noopRecorder, type AnswerRecord, type GameRecorder, type RecordInput } from "./recorder";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface PackInfo {
  quiz_pack_id: string;
  default_time_limit_sec: number;
  default_base_points: number;
  speed_tiers?: SpeedTier[];
}

/** Server-only access to the Question Bank (Supabase service role). */
export interface QuestionBankRepo {
  getPack(packId: string): Promise<PackInfo | null>;
  getPackQuestionIds(packId: string): Promise<string[]>; // ordered
  getQuestion(questionId: string): Promise<BankQuestion | null>;
}

export type PublicSnapshot = Omit<RoomState, "question_ids"> & {
  total_questions: number;
  server_now: number;
};

/**
 * Only state changes are broadcast. Fast-changing counters (teams joined,
 * answers in) are polled by the admin and stage screens instead, which keeps
 * realtime traffic to a handful of messages per question.
 */
export type RealtimeEvent = { kind: "state"; snapshot: PublicSnapshot };

export interface Publisher {
  publish(roomCode: string, event: RealtimeEvent): Promise<void>;
}

export interface Clock {
  now(): number;
}

export type AnswerResult =
  | { ok: true; received_at: number }
  | { ok: false; reason: "NOT_ACCEPTING" | "ALREADY_ANSWERED" | "INVALID_ANSWER" | "FROZEN" | "UNKNOWN_TEAM" | "TEAM_MOVED" };

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const MAX_CAS_RETRIES = 3;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

/** Extra data gathered while resolving a command, passed on to the recorder. */
type ResolveContext = Pick<RecordInput, "question" | "pack" | "answers" | "teams" | "overrides">;

export class GameEngine {
  /** Keeps the permanent competition log. Set by the server; tests may replace it. */
  recorder: GameRecorder = noopRecorder;

  constructor(
    private store: RoomStore,
    private bank: QuestionBankRepo,
    private publisher: Publisher,
    private clock: Clock = { now: () => Date.now() },
    private newId: () => string = () => crypto.randomUUID(),
  ) {}

  // ----- Room lifecycle ----------------------------------------------------

  async createRoom(settings: Partial<RoomSettings> = {}): Promise<RoomState> {
    for (let i = 0; i < 10; i++) {
      const code = Array.from({ length: 5 }, () =>
        ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)],
      ).join("");
      if (settings.scoring_mode !== undefined && !SCORING_MODES.includes(settings.scoring_mode)) {
        throw new GameError("BAD_REQUEST", "Unknown scoring mode");
      }
      // The seed shuffles ordering and matching items; it never leaves the server.
      const state: RoomState = { ...createInitialState(code, this.clock.now(), settings), secret_seed: this.newId() };
      if (await this.store.createState(state)) return state;
    }
    throw new Error("Could not allocate a room code");
  }

  async getState(code: string): Promise<RoomState> {
    const s = await this.store.getState(code);
    if (!s) throw new GameError("ROOM_NOT_FOUND", `Room ${code} not found`);
    return s;
  }

  // ----- Admin commands ----------------------------------------------------

  /**
   * Apply an admin (or timer) command. Resolves the data the command needs,
   * runs the pure transition, and writes with compare-and-set so two admin
   * tabs clicking at once can't both advance the game.
   */
  async dispatch(code: string, cmd: AdminCommand | { type: "TIMER_EXPIRED" }): Promise<RoomState> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const state = await this.getState(code);
      assertCanApply(state, cmd.type); // fail fast before any expensive resolving
      const now = this.clock.now();
      const { event, ctx } = await this.resolve(state, cmd);
      const next = transition(state, event, now);
      if (await this.store.compareAndSetState(code, state.version, next)) {
        try {
          await this.publisher.publish(code, { kind: "state", snapshot: toPublicSnapshot(next, now) });
        } catch (e) {
          // The write succeeded; clients will catch up on their next poll.
          console.error("realtime publish failed", e);
        }
        await this.recordSafely(() => this.recorder.onTransition({ command: cmd, prev: state, next, at: now, ...ctx }));
        return next;
      }
      // Someone else moved the room on. Re-read and re-validate: the command
      // may no longer be legal (e.g. both admin tabs clicked REVEAL).
    }
    throw new GameError("VERSION_CONFLICT", "Room changed concurrently, try again");
  }

  /** The log must never stop the game: failures are reported and the game carries on. */
  private async recordSafely(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      console.error("competition log: could not record", e);
    }
  }

  /** Idempotent: closes the question if (and only if) its time is up. */
  async tick(code: string): Promise<RoomState> {
    const state = await this.getState(code);
    if (state.phase !== "PLAYING" || state.question_ends_at === null) return state;
    if (this.clock.now() < state.question_ends_at) return state;
    try {
      return await this.dispatch(code, { type: "TIMER_EXPIRED" });
    } catch (e) {
      if (e instanceof GameError && (e.code === "ILLEGAL_TRANSITION" || e.code === "VERSION_CONFLICT")) {
        return this.getState(code); // another caller already closed it
      }
      throw e;
    }
  }

  private async resolve(
    state: RoomState,
    cmd: AdminCommand | { type: "TIMER_EXPIRED" },
  ): Promise<{ event: ResolvedEvent; ctx: ResolveContext }> {
    switch (cmd.type) {
      case "SELECT_PACK": {
        const pack = await this.bank.getPack(cmd.quiz_pack_id);
        if (!pack) throw new GameError("BAD_REQUEST", `Unknown pack ${cmd.quiz_pack_id}`);
        const question_ids = await this.bank.getPackQuestionIds(cmd.quiz_pack_id);
        return { event: { type: "SELECT_PACK", quiz_pack_id: cmd.quiz_pack_id, question_ids }, ctx: { pack } };
      }
      case "START_QUESTION": {
        const index = state.current_question_index + 1;
        const [q, pack] = await Promise.all([
          this.bank.getQuestion(state.question_ids[index]),
          this.bank.getPack(state.quiz_pack_id!),
        ]);
        if (!q || !pack) throw new GameError("BAD_REQUEST", "Question or pack missing from bank");
        const question = toPublicQuestion(q, index, state.question_ids.length, pack, seedOf(state));
        if (cmd.time_limit_sec !== undefined) {
          const t = Math.round(Number(cmd.time_limit_sec));
          if (!Number.isFinite(t) || t < 5 || t > 600) throw new GameError("BAD_REQUEST", "Time must be between 5 and 600 seconds");
          question.time_limit_sec = t;
        }
        return { event: { type: "START_QUESTION", question }, ctx: { question: q, pack } };
      }
      case "REVEAL_ANSWER": {
        const { reveal, leaderboard, question, pack, answers, teams, overrides } = await this.scoreCurrentQuestion(state);
        return { event: { type: "REVEAL_ANSWER", reveal, leaderboard }, ctx: { question, pack, answers, teams, overrides } };
      }
      case "MEDIA":
        if (!["PLAY", "PAUSE", "RESTART"].includes(cmd.action)) throw new GameError("BAD_REQUEST", "Unknown media action");
        return { event: { type: "MEDIA", action: cmd.action }, ctx: {} };
      case "SHOW_TIE_BREAK": {
        const { qualification } = await this.qualify(state, cmd.qualify_count);
        const tie_break = cutTieBreak(qualification.final_standings, cmd.qualify_count);
        if (!tie_break) throw new GameError("BAD_REQUEST", "No teams are level on score at the cut, so there is no tie-break to show");
        return { event: { type: "SHOW_TIE_BREAK", tie_break }, ctx: {} };
      }
      case "SHOW_QUALIFICATION": {
        const { qualification, teams } = await this.qualify(state, cmd.qualify_count);
        return { event: { type: "SHOW_QUALIFICATION", qualification }, ctx: { teams } };
      }
      case "ADJUST_TIME": {
        const d = Math.round(Number(cmd.delta_sec));
        if (!Number.isFinite(d) || d === 0 || Math.abs(d) > 300) throw new GameError("BAD_REQUEST", "Time change must be between -300 and 300 seconds");
        return { event: { type: "ADJUST_TIME", delta_sec: d }, ctx: {} };
      }
      case "TERMINATE":
        // Final team list (with anti-cheat flags) for the log.
        return { event: { type: "TERMINATE" }, ctx: { teams: await this.store.getTeams(state.room_code) } };
      case "END_QUESTION":
      case "TIMER_EXPIRED":
      case "SHOW_LEADERBOARD":
        return { event: { type: cmd.type }, ctx: {} };
    }
  }

  /**
   * Batch-scores every team for the current question. Runs once per question,
   * inside the REVEAL transition, so the running scoreboard is updated in the
   * same versioned write as the phase change.
   */
  private async scoreCurrentQuestion(state: RoomState) {
    const qIndex = state.current_question_index;
    const teams = await this.store.getTeams(state.room_code);
    const scored = await this.scoreQuestion(state, qIndex, {
      started_at: state.question_started_at!,
      ends_at: state.question_ends_at ?? state.question_started_at!,
      voided: new Set(teams.filter((t) => t.frozen_for_question === qIndex).map((t) => t.team_id)),
      tallies: talliesOf(state.leaderboard),
      teams,
    });
    // Kept so the host can correct this question's marking after the reveal.
    await this.store.putQuestionResult(state.room_code, qIndex, scored.record);
    return scored;
  }

  /**
   * Scores every team for one question, adding to the given running tallies.
   * Used at the reveal, and again when the host corrects a revealed question.
   */
  private async scoreQuestion(
    state: RoomState,
    qIndex: number,
    at: { started_at: number; ends_at: number; voided: Set<string>; tallies: Record<string, Tally>; teams: Team[] },
  ): Promise<{
    reveal: RevealPayload;
    leaderboard: ScoreRow[];
    question: BankQuestion;
    pack: PackInfo;
    answers: AnswerRecord[];
    teams: Team[];
    overrides: MarkOverride[];
    record: QuestionResultRecord;
  }> {
    const teams = at.teams;
    const [q, pack, subs, overrides] = await Promise.all([
      this.bank.getQuestion(state.question_ids[qIndex]),
      this.bank.getPack(state.quiz_pack_id!),
      this.store.getSubmissions(state.room_code, qIndex),
      this.store.getOverrides(state.room_code, qIndex),
    ]);
    if (!q || !pack) throw new GameError("BAD_REQUEST", "Question or pack missing from bank");

    const byTeam = new Map(subs.map((s) => [s.team_id, s]));
    const tallies = at.tallies;
    const record: QuestionResultRecord = { started_at: at.started_at, ends_at: at.ends_at, voided: [...at.voided], results: {} };

    const results: RevealPayload["results"] = {};
    const distribution: Record<string, number> | null = isChoiceType(q.type) ? {} : null;
    if (distribution) for (const c of q.choices ?? []) distribution[c.choice_id] = 0;
    const timing = {
      mode: state.settings.scoring_mode ?? "CLASSIC",
      limit_ms: at.ends_at - at.started_at,
    };
    const basePoints = q.base_points ?? pack.default_base_points;
    const answers: AnswerRecord[] = [];

    for (const team of teams) {
      const sub = byTeam.get(team.team_id);
      const voided = at.voided.has(team.team_id);
      const r = scoreSubmission(
        q,
        team.team_id,
        sub,
        at.started_at,
        voided,
        { base_points: pack.default_base_points, speed_tiers: pack.speed_tiers },
        overrides,
        timing,
      );
      results[team.team_id] = {
        correct: r.correct,
        points: r.points,
        fraction: r.fraction,
        answered: r.answered,
        voided_by_anti_cheat: r.voided_by_anti_cheat,
        ...(r.sub_correct ? { sub_correct: r.sub_correct } : {}),
      };
      record.results[team.team_id] = { points: r.points, correct: r.correct, elapsed_ms: r.correct ? r.elapsed_ms ?? 0 : null };
      const t = (tallies[team.team_id] ??= { score: 0, correct_count: 0, total_correct_time_ms: 0 });
      t.score += r.points;
      if (r.correct) {
        t.correct_count += 1;
        t.total_correct_time_ms += r.elapsed_ms ?? 0;
      }
      if (distribution && sub) for (const c of sub.answer) distribution[c] = (distribution[c] ?? 0) + 1;
      answers.push({
        team_id: team.team_id,
        team_name: team.name,
        answered: !!sub,
        answer: sub ? sub.answer : null,
        received_at: sub ? sub.received_at : null,
        elapsed_ms: r.elapsed_ms,
        correct: r.correct,
        fraction: r.fraction,
        base_points: r.base_points,
        speed_bonus: r.speed_bonus,
        ...(r.time_factor !== undefined ? { time_factor: r.time_factor } : {}),
        points: r.points,
        // Locked out by anti-cheat for this question (whether or not an answer had arrived).
        voided,
        marking: sub ? explainAnswer(q, sub.answer, basePoints, overrides) : null,
        flags: team.flags.filter((f) => f.question_index === qIndex),
      });
    }

    const isText = q.type === "TEXT_INPUT";
    const isSub = q.type === "SUB_QUESTIONS_TEXT";
    const isSeq = isSequenceType(q.type);
    const applied = Object.values(overrides).sort((a, b) => a.at - b.at);
    // Answers the host accepted by hand, shown on the big screen with the answer.
    const hostAccepted = (part: number | null) =>
      applied.filter((o) => o.verdict === "CORRECT" && !o.key.startsWith("c:") && o.part === part).map((o) => o.label);
    const subPts = isSub ? subQuestionPoints(q, q.base_points ?? pack.default_base_points) : [];
    const sub_reveal = isSub
      ? (q.sub_questions ?? []).map((sq, i) => ({
          sub_id: sq.sub_id,
          prompt: sq.prompt,
          answer: sq.correct_answers_array[0] ?? "",
          aliases: [...sq.correct_answers_array.slice(1), ...hostAccepted(i)],
          points: subPts[i],
          correct_teams: Object.values(results).filter((r) => r.sub_correct?.[i]).length,
        }))
      : null;
    // Ordering / matching: the correct order (or pairs), with how many teams got each position right.
    const seqN = isSeq ? sequenceLength(q) : 0;
    const marked = isSeq
      ? subs.filter((s) => !at.voided.has(s.team_id) && teams.some((t) => t.team_id === s.team_id)).map((s) => markSequence(seqN, s.answer).correct)
      : [];
    const sequence_reveal = isSeq
      ? sequenceKey(seqN).map((id, i) => ({
          text: q.type === "MATCHING" ? `${q.pairs![i].left} → ${q.pairs![i].right}` : q.choices![i].text,
          ...(q.type === "ORDERING" && q.choices![i].media_url ? { media_url: q.choices![i].media_url } : {}),
          correct_teams: marked.filter((m) => m[i]).length,
        }))
      : null;
    return {
      reveal: {
        question_index: qIndex,
        question_id: q.question_id,
        type: q.type,
        correct_display: isText
          ? [q.correct_answers_array[0]]
          : isSub
            ? (sub_reveal ?? []).map((x) => x.answer)
            : isSeq
              ? (sequence_reveal ?? []).map((x) => x.text)
              : effectiveChoiceKey(q, overrides),
        accepted_aliases: isText ? q.correct_answers_array.slice(1) : [],
        host_accepted: isText ? hostAccepted(null) : isSeq ? applied.filter((o) => o.verdict === "CORRECT").map((o) => o.label) : [],
        review_changes: applied.length,
        sub_reveal,
        sequence_reveal,
        explanation: q.explanation ?? null,
        results,
        answer_distribution: distribution,
      },
      leaderboard: rankTeams(teams, tallies, state.leaderboard),
      question: q,
      pack,
      answers,
      teams,
      overrides: applied,
      record,
    };
  }

  // ----- Host review before the reveal -----------------------------------

  /** Every answer so far for the current question, grouped, with the automatic and final marking. */
  private async currentReview(state: RoomState, teams?: Team[], subs?: Submission[]): Promise<{ review: ReviewPayload; question: BankQuestion } | null> {
    if (state.phase !== "PLAYING" && state.phase !== "SUBMITTED_WAITING") return null;
    const qIndex = state.current_question_index;
    const [q, t, s, overrides] = await Promise.all([
      this.bank.getQuestion(state.question_ids[qIndex]),
      teams ? Promise.resolve(teams) : this.store.getTeams(state.room_code),
      subs ? Promise.resolve(subs) : this.store.getSubmissions(state.room_code, qIndex),
      this.store.getOverrides(state.room_code, qIndex),
    ]);
    if (!q) return null;
    return { review: buildReview(q, qIndex, s, t, overrides), question: q };
  }

  /**
   * The host marks a group of identical answers right or wrong by hand (or
   * undoes a change with verdict null). Allowed only before the reveal, only
   * for the question on screen, and only for answers that actually arrived
   * (or, for multiple choice, a choice of this question). Every change is
   * logged in the competition log straight away.
   */
  async setReview(code: string, input: { question_index: number; key: string; verdict: Verdict | null }): Promise<ReviewPayload> {
    const state = await this.getState(code);
    if (state.phase !== "PLAYING" && state.phase !== "SUBMITTED_WAITING") {
      throw new GameError("BAD_REQUEST", "Marking can only be changed before the answer is revealed");
    }
    if (input.question_index !== state.current_question_index) {
      throw new GameError("BAD_REQUEST", "That question is no longer on screen. Refresh and try again.");
    }
    if (input.verdict !== null && input.verdict !== "CORRECT" && input.verdict !== "WRONG") {
      throw new GameError("BAD_REQUEST", "Verdict must be CORRECT, WRONG or null");
    }
    const current = await this.currentReview(state);
    if (!current) throw new GameError("BAD_REQUEST", "Question missing from bank");
    const group = findGroup(current.review, input.key);
    if (!group) throw new GameError("BAD_REQUEST", "No answer like that has arrived for this question");

    const qIndex = state.current_question_index;
    const now = this.clock.now();
    // Same as the automatic marking = no change needed. (A part-right ordering or matching answer
    // is not the same as "wrong": marking it wrong takes its partial points away.)
    const verdict = input.verdict === group.auto && group.partial === undefined ? null : input.verdict;
    await this.store.setOverride(code, qIndex, group.key, verdict ? toOverride(group, verdict, now) : null);

    // If the reveal happened in the meantime, this change did not count: take it back and say so.
    const after = await this.getState(code);
    if (after.current_question_index !== qIndex || (after.phase !== "PLAYING" && after.phase !== "SUBMITTED_WAITING")) {
      await this.store.setOverride(code, qIndex, group.key, null);
      throw new GameError("BAD_REQUEST", "The answer was revealed before this change could be applied");
    }

    await this.recordSafely(async () =>
      this.recorder.onReview?.(state, now, {
        question_index: qIndex,
        question_id: current.question.question_id,
        key: group.key,
        label: group.label,
        part: group.part,
        verdict,
        auto: group.auto,
        teams: group.team_names,
      }),
    );
    const updated = await this.currentReview(after);
    return updated!.review;
  }

  // ----- Correcting a question after its reveal ---------------------------

  /**
   * The review (grouped answers, marking) of a question that has already been
   * revealed, so the host can uphold a challenge. Only between questions and
   * before the qualified teams are shown.
   */
  async revealedReview(code: string, qIndex: number): Promise<ReviewPayload> {
    const state = await this.getState(code);
    const { question, review } = await this.loadRevealed(state, qIndex);
    void question;
    return review;
  }

  private async loadRevealed(state: RoomState, qIndex: number) {
    if (!CORRECTION_PHASES.includes(state.phase)) {
      throw new GameError("BAD_REQUEST", state.phase === "QUALIFICATION_REVEAL" || state.phase === "ENDED" || state.phase === "TIE_BREAK"
        ? "Scores are final once the tie-break or the qualified teams are shown. Go back to the leaderboard first."
        : "Corrections can be made between questions (after a reveal or on the leaderboard)");
    }
    if (!Number.isInteger(qIndex) || qIndex < 0 || qIndex > state.current_question_index) {
      throw new GameError("BAD_REQUEST", "That question hasn't been revealed yet");
    }
    const [q, rec, teams, subs, overrides] = await Promise.all([
      this.bank.getQuestion(state.question_ids[qIndex]),
      this.store.getQuestionResult(state.room_code, qIndex),
      this.store.getTeams(state.room_code),
      this.store.getSubmissions(state.room_code, qIndex),
      this.store.getOverrides(state.room_code, qIndex),
    ]);
    if (!q) throw new GameError("BAD_REQUEST", "Question missing from bank");
    if (!rec) throw new GameError("BAD_REQUEST", "This question was revealed before corrections were possible (app updated during the game), so it can't be corrected here");
    const voided = new Set(rec.voided);
    // The review marks teams voided for this question the way they were at the reveal.
    const asAtReveal = teams.map((t) => ({ ...t, frozen_for_question: voided.has(t.team_id) ? qIndex : null }));
    return { question: q, rec, teams, subs, overrides, review: buildReview(q, qIndex, subs, asAtReveal, overrides) };
  }

  /**
   * Upholds (or reverses) a challenge on a revealed question: marks a group of
   * answers right or wrong, re-scores that question for every team and adjusts
   * the leaderboard. Logged with each team's points before and after.
   */
  async correctRevealed(code: string, input: { question_index: number; key: string; verdict: Verdict | null }): Promise<{
    review: ReviewPayload;
    changes: { team_id: string; name: string; before: number; after: number }[];
  }> {
    if (input.verdict !== null && input.verdict !== "CORRECT" && input.verdict !== "WRONG") {
      throw new GameError("BAD_REQUEST", "Verdict must be CORRECT, WRONG or null");
    }
    const qIndex = input.question_index;
    const first = await this.loadRevealed(await this.getState(code), qIndex);
    const group = findGroup(first.review, input.key);
    if (!group) throw new GameError("BAD_REQUEST", "No answer like that was given for this question");
    const now = this.clock.now();
    const verdict = input.verdict === group.auto && group.partial === undefined ? null : input.verdict;
    const previousOverride = first.overrides[group.key] ?? null;
    await this.store.setOverride(code, qIndex, group.key, verdict ? toOverride(group, verdict, now) : null);

    try {
      for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
        const state = await this.getState(code);
        const { rec, teams } = await this.loadRevealed(state, qIndex);
        // Take this question's old points out, then score it again with the new marking.
        const tallies = talliesOf(state.leaderboard);
        for (const [teamId, r] of Object.entries(rec.results)) {
          const t = tallies[teamId];
          if (!t) continue;
          t.score -= r.points;
          if (r.correct) {
            t.correct_count -= 1;
            t.total_correct_time_ms -= r.elapsed_ms ?? 0;
          }
        }
        const scored = await this.scoreQuestion(state, qIndex, { started_at: rec.started_at, ends_at: rec.ends_at, voided: new Set(rec.voided), tallies, teams });
        const next: RoomState = {
          ...state,
          version: state.version + 1,
          updated_at: now,
          leaderboard: scored.leaderboard,
          // The answer on the big screen is this question: show the corrected marking.
          reveal: state.reveal && state.reveal.question_index === qIndex ? scored.reveal : state.reveal,
        };
        if (!(await this.store.compareAndSetState(code, state.version, next))) continue;
        await this.store.putQuestionResult(code, qIndex, scored.record);
        try {
          await this.publisher.publish(code, { kind: "state", snapshot: toPublicSnapshot(next, now) });
        } catch (e) {
          console.error("realtime publish failed", e);
        }
        const changes = teams
          .map((t) => ({ team_id: t.team_id, name: t.name, before: rec.results[t.team_id]?.points ?? 0, after: scored.record.results[t.team_id]?.points ?? 0 }))
          .filter((c) => c.before !== c.after);
        await this.recordSafely(async () =>
          this.recorder.onCorrection?.(next, now, {
            question_index: qIndex,
            question_id: scored.question.question_id,
            key: group.key,
            label: group.label,
            part: group.part,
            verdict,
            auto: group.auto,
            teams: group.team_names,
            changes,
          }, { question: scored.question, answers: scored.answers, overrides: scored.overrides }),
        );
        const after = await this.loadRevealed(next, qIndex);
        return { review: after.review, changes };
      }
      throw new GameError("VERSION_CONFLICT", "Room changed concurrently, try again");
    } catch (e) {
      // The scores were not updated: put the marking back the way it was.
      await this.store.setOverride(code, qIndex, group.key, previousOverride);
      throw e;
    }
  }

  // ----- Team management (host) --------------------------------------------

  /** Writes a change that isn't a phase transition (team list, names) and broadcasts it. */
  private async updateState(code: string, change: (s: RoomState) => RoomState | null): Promise<RoomState> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const state = await this.getState(code);
      const changed = change(state);
      if (!changed) return state;
      const now = this.clock.now();
      const next = { ...changed, version: state.version + 1, updated_at: now };
      if (await this.store.compareAndSetState(code, state.version, next)) {
        try {
          await this.publisher.publish(code, { kind: "state", snapshot: toPublicSnapshot(next, now) });
        } catch (e) {
          console.error("realtime publish failed", e);
        }
        return next;
      }
    }
    throw new GameError("VERSION_CONFLICT", "Room changed concurrently, try again");
  }

  async renameTeam(code: string, teamId: string, rawName: string): Promise<Team> {
    const name = cleanTeamName(rawName);
    const state = await this.getState(code);
    if (state.phase === "ENDED") throw new GameError("BAD_REQUEST", "This game has finished");
    const team = await this.store.getTeam(code, teamId);
    if (!team) throw new GameError("BAD_REQUEST", "No such team");
    const old = team.name;
    if (old === name) return team;
    if ((await this.store.renameTeam(code, team, name)) === "NAME_TAKEN") throw new GameError("BAD_REQUEST", "That team name is taken");
    const rename = <T extends { team_id: string; name: string }>(rows: T[]) => rows.map((r) => (r.team_id === teamId ? { ...r, name } : r));
    const next = await this.updateState(code, (s) => ({
      ...s,
      leaderboard: rename(s.leaderboard),
      qualification: s.qualification ? { ...s.qualification, final_standings: rename(s.qualification.final_standings) } : s.qualification,
      tie_break: s.tie_break ? { ...s.tie_break, rows: rename(s.tie_break.rows) } : s.tie_break ?? null,
    }));
    await this.recordSafely(async () => this.recorder.onEvent?.(next, this.clock.now(), "TEAM_RENAMED", null, { team_id: teamId, from: old, to: name }));
    return { ...team, name };
  }

  /** Takes a team out of the game (a test entry, a duplicate). Its answers stop counting. */
  async removeTeam(code: string, teamId: string): Promise<void> {
    const state = await this.getState(code);
    if (state.phase === "ENDED" || state.phase === "QUALIFICATION_REVEAL" || state.phase === "TIE_BREAK") {
      throw new GameError("BAD_REQUEST", "Teams can't be removed once the tie-break or the qualified teams are shown");
    }
    const team = await this.store.getTeam(code, teamId);
    if (!team) throw new GameError("BAD_REQUEST", "No such team");
    const row = state.leaderboard.find((r) => r.team_id === teamId);
    await this.store.removeTeam(code, team);
    const teams = await this.store.getTeams(code);
    const next = await this.updateState(code, (s) => {
      if (!s.leaderboard.some((r) => r.team_id === teamId)) return null;
      return { ...s, leaderboard: rankTeams(teams, talliesOf(s.leaderboard), s.leaderboard) };
    });
    await this.recordSafely(async () =>
      this.recorder.onEvent?.(next, this.clock.now(), "TEAM_REMOVED", next.current_question_index >= 0 ? next.current_question_index : null, {
        team_id: teamId,
        name: team.name,
        score: row?.score ?? 0,
      }),
    );
  }

  /** The host issues a one-time code so a team can carry on from a new device (e.g. the old one died). */
  async startTransfer(code: string, teamId: string): Promise<{ transfer_code: string; expires_at: number }> {
    const state = await this.getState(code);
    if (state.phase === "ENDED") throw new GameError("BAD_REQUEST", "This game has finished");
    const team = await this.store.getTeam(code, teamId);
    if (!team) throw new GameError("BAD_REQUEST", "No such team");
    const transfer_code = String(Math.floor(100000 + Math.random() * 900000));
    const expires_at = this.clock.now() + TRANSFER_TTL_MS;
    team.transfer = { code: transfer_code, expires_at };
    await this.store.saveTeam(code, team);
    await this.recordSafely(async () => this.recorder.onEvent?.(state, this.clock.now(), "DEVICE_MOVE_STARTED", null, { team_id: teamId, name: team.name }));
    return { transfer_code, expires_at };
  }

  /**
   * A new device enters the host's code: it becomes the team's device and the
   * old one stops working. Returns the team and its new device number.
   */
  async claimTransfer(code: string, rawCode: string): Promise<{ team: Team; device: number }> {
    const state = await this.getState(code);
    if (state.phase === "ENDED") throw new GameError("BAD_REQUEST", "This game has finished");
    const given = String(rawCode ?? "").replace(/\D/g, "");
    const now = this.clock.now();
    const team = given.length === 6 ? (await this.store.getTeams(code)).find((t) => t.transfer?.code === given && t.transfer.expires_at >= now) : undefined;
    if (!team) throw new GameError("BAD_REQUEST", "That code isn't valid or has expired. Ask the host for a new one.");
    team.device = (team.device ?? 0) + 1;
    team.transfer = null;
    await this.store.saveTeam(code, team);
    await this.recordSafely(async () => this.recorder.onEvent?.(state, now, "DEVICE_MOVED", state.current_question_index >= 0 ? state.current_question_index : null, { team_id: team.team_id, name: team.name }));
    return { team, device: team.device };
  }

  /** Whether a player's device is still the team's device. */
  async teamStatus(code: string, teamId: string, device: number): Promise<"OK" | "UNKNOWN" | "MOVED"> {
    const team = await this.store.getTeam(code, teamId);
    if (!team) return "UNKNOWN";
    return (team.device ?? 0) === device ? "OK" : "MOVED";
  }

  private async qualify(state: RoomState, qualifyCount: number): Promise<{ qualification: QualificationPayload; teams: Team[] }> {
    if (!Number.isInteger(qualifyCount) || qualifyCount < 1) {
      throw new GameError("BAD_REQUEST", "qualify_count must be a positive integer");
    }
    // Re-rank so teams that joined but never scored are included.
    const teams = await this.store.getTeams(state.room_code);
    const tallies: Record<string, Tally> = Object.fromEntries(
      state.leaderboard.map((r) => [r.team_id, r]),
    );
    const standings = rankTeams(teams, tallies, state.leaderboard);
    // Rank-based cut: a team tied with the last qualifying rank also qualifies.
    return {
      qualification: {
        qualify_count: qualifyCount,
        qualified_team_ids: qualifiedIds(standings, qualifyCount),
        final_standings: standings,
      },
      teams,
    };
  }

  // ----- Player actions ----------------------------------------------------

  async joinTeam(code: string, rawName: string): Promise<Team> {
    const state = await this.getState(code);
    if (state.phase === "ENDED" || state.phase === "QUALIFICATION_REVEAL" || state.phase === "TIE_BREAK") {
      throw new GameError("BAD_REQUEST", "This game has finished");
    }
    const name = cleanTeamName(rawName);

    const team: Team = { team_id: this.newId(), name, joined_at: this.clock.now(), flags: [], frozen_for_question: null };
    const res = await this.store.addTeam(code, team, state.settings.max_teams);
    if (res === "NAME_TAKEN") throw new GameError("BAD_REQUEST", "That team name is taken");
    if (res === "ROOM_FULL") throw new GameError("BAD_REQUEST", "Room is full");

    return team;
  }

  /**
   * Hot path. One state read + one HSETNX. No scoring, no Postgres, no
   * full-state broadcast. Answers stay sealed until REVEAL.
   */
  async submitAnswer(code: string, teamId: string, answer: string[], device = 0): Promise<AnswerResult> {
    const now = this.clock.now(); // stamp on arrival, before any awaits
    const [state, team] = await Promise.all([this.getState(code), this.store.getTeam(code, teamId)]);
    if (!team) return { ok: false, reason: "UNKNOWN_TEAM" };
    if ((team.device ?? 0) !== device) return { ok: false, reason: "TEAM_MOVED" };
    if (!isAcceptingAnswers(state, now)) return { ok: false, reason: "NOT_ACCEPTING" };
    if (team.frozen_for_question === state.current_question_index) return { ok: false, reason: "FROZEN" };

    const q = state.current_question!;
    let cleaned = validateAnswerShape(q, answer);
    if (!cleaned) return { ok: false, reason: "INVALID_ANSWER" };
    // Ordering / matching: phones send display letters; store the question's own ids.
    if (isSequenceType(q.type)) cleaned = toOwnIds(cleaned, q.choices?.length ?? 0, seedOf(state), q.question_id);

    const sub: Submission = { team_id: teamId, question_index: state.current_question_index, answer: cleaned, received_at: now };
    const stored = await this.store.putSubmissionIfAbsent(code, sub);
    if (!stored) return { ok: false, reason: "ALREADY_ANSWERED" };

    return { ok: true, received_at: now };
  }

  /**
   * Called by the player client when the page regains visibility. The client
   * reports how long it was hidden; the server decides what that means.
   * (A client that never reports can't be caught this way — this is a
   * deterrent, not proof. The admin sees every flag.)
   */
  async reportFocusLoss(
    code: string,
    teamId: string,
    durationMs: number,
    kind: "FOCUS_LOST" | "PASTE_ATTEMPT" | "WINDOW_BLUR" = "FOCUS_LOST",
    device = 0,
  ): Promise<{ flagged: boolean; frozen: boolean }> {
    const [state, team] = await Promise.all([this.getState(code), this.store.getTeam(code, teamId)]);
    if (!team || state.phase !== "PLAYING" || (team.device ?? 0) !== device) return { flagged: false, frozen: false };
    const duration = Math.max(0, Math.min(Number(durationMs) || 0, 10 * 60 * 1000));
    if (kind !== "PASTE_ATTEMPT" && duration < state.settings.focus_violation_ms) return { flagged: false, frozen: false };

    const qIndex = state.current_question_index;
    team.flags.push({ question_index: qIndex, kind, duration_ms: duration, at: this.clock.now() });

    // Freeze only for leaving the page before answering. Paste attempts are
    // blocked in the browser anyway, and another window in front of a visible
    // quiz page (computers) can't be told apart from a stray click, so those
    // are just recorded for the host and judges.
    let freeze = false;
    if (kind === "FOCUS_LOST" && state.settings.anti_cheat_policy === "VOID_CURRENT_ANSWER") {
      const already = await this.store.getSubmission(code, qIndex, teamId);
      freeze = !already;
    }
    if (freeze) team.frozen_for_question = qIndex;
    await this.store.saveTeam(code, team);
    return { flagged: true, frozen: freeze || team.frozen_for_question === qIndex };
  }

  /** Lobby / progress info that the stage may show. No answers. */
  async getPublicStatus(code: string) {
    const state = await this.getState(code);
    const teams = await this.store.getTeams(code);
    const answered =
      state.phase === "PLAYING" || state.phase === "SUBMITTED_WAITING"
        ? await this.store.countSubmissions(code, state.current_question_index)
        : 0;
    return {
      phase: state.phase,
      version: state.version,
      team_count: teams.length,
      team_names: teams.sort((a, b) => a.joined_at - b.joined_at).map((t) => t.name),
      answered_count: answered,
      server_now: this.clock.now(),
    };
  }

  /** Everything the admin control panel needs, including the current answer. */
  async getAdminStatus(code: string) {
    const state = await this.getState(code);
    const [teams, subs] = await Promise.all([
      this.store.getTeams(code),
      state.current_question_index >= 0
        ? this.store.getSubmissions(code, state.current_question_index)
        : Promise.resolve([] as Submission[]),
    ]);
    const current =
      state.current_question_index >= 0 ? await this.bank.getQuestion(state.question_ids[state.current_question_index]) : null;
    const nextIndex = state.current_question_index + 1;
    let next_question: { index: number; question_text: string; type: string; time_limit_sec: number; media_url: string | null } | null = null;
    if (state.quiz_pack_id && nextIndex < state.question_ids.length) {
      const [nq, pack] = await Promise.all([this.bank.getQuestion(state.question_ids[nextIndex]), this.bank.getPack(state.quiz_pack_id)]);
      if (nq) {
        next_question = {
          index: nextIndex,
          question_text: nq.question_text,
          type: nq.type,
          time_limit_sec: nq.time_limit_sec ?? pack?.default_time_limit_sec ?? 30,
          media_url: nq.media_url ?? null,
        };
      }
    }
    const answeredBy = new Map(subs.map((s) => [s.team_id, s]));
    const rankOf = new Map(state.leaderboard.map((r) => [r.team_id, r]));
    const review = current && (state.phase === "PLAYING" || state.phase === "SUBMITTED_WAITING") ? await this.currentReview(state, teams, subs) : null;
    return {
      snapshot: toPublicSnapshot(state, this.clock.now()),
      review: review?.review ?? null,
      settings: state.settings,
      next_question,
      current_answer: current
        ? {
            correct_answers_array: current.correct_answers_array,
            type: current.type,
            explanation: current.explanation ?? null,
            sub_questions: current.sub_questions ?? null,
            // Ordering / matching: the answer in words, for the host's crib sheet.
            sequence: isSequenceType(current.type)
              ? current.type === "MATCHING"
                ? (current.pairs ?? []).map((p) => `${p.left} → ${p.right}`)
                : (current.choices ?? []).map((c) => c.text || "(picture)")
              : null,
          }
        : null,
      teams: teams
        .sort((a, b) => (rankOf.get(a.team_id)?.rank ?? 1e9) - (rankOf.get(b.team_id)?.rank ?? 1e9) || a.joined_at - b.joined_at)
        .map((t) => ({
          team_id: t.team_id,
          name: t.name,
          joined_at: t.joined_at,
          score: rankOf.get(t.team_id)?.score ?? 0,
          rank: rankOf.get(t.team_id)?.rank ?? null,
          answered: answeredBy.has(t.team_id),
          answer: answeredBy.get(t.team_id)?.answer ?? null,
          // Ordering / matching: the answer in words (the ids alone mean little to the host).
          answer_text: current && isSequenceType(current.type) && answeredBy.has(t.team_id) ? describeSequence(current, answeredBy.get(t.team_id)!.answer) : null,
          flags: t.flags,
          frozen_now: t.frozen_for_question === state.current_question_index && state.current_question_index >= 0,
        })),
      answered_count: subs.length,
    };
  }

  async deleteRoom(code: string) {
    const state = await this.store.getState(code);
    await this.store.deleteRoom(code);
    if (state) await this.recordSafely(() => this.recorder.onRoomDeleted(state, this.clock.now()));
  }

  async listRooms() {
    return this.store.listRooms();
  }

  /** Everything a /play client needs to rebuild its screen after a reconnect. */
  async getPlayerContext(code: string, teamId: string) {
    const state = await this.getState(code);
    const team = await this.store.getTeam(code, teamId);
    if (!team) throw new GameError("BAD_REQUEST", "Unknown team");
    const sub =
      state.current_question_index >= 0
        ? await this.store.getSubmission(code, state.current_question_index, teamId)
        : null;
    return {
      snapshot: toPublicSnapshot(state, this.clock.now()),
      me: {
        team_id: team.team_id,
        name: team.name,
        has_submitted: !!sub,
        my_answer: sub && state.current_question && isSequenceType(state.current_question.type)
          ? toDisplayIds(sub.answer, state.current_question.choices?.length ?? 0, seedOf(state), state.current_question.question_id)
          : sub?.answer ?? null,
        frozen: team.frozen_for_question === state.current_question_index,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Running totals from a leaderboard, as a fresh object the caller may change. */
export function talliesOf(rows: ScoreRow[]): Record<string, Tally> {
  return Object.fromEntries(rows.map((r) => [r.team_id, { score: r.score, correct_count: r.correct_count, total_correct_time_ms: r.total_correct_time_ms }]));
}

const TEAM_NAME_ERROR = "Team name must be 2-32 characters";
function cleanTeamName(raw: string): string {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 32) throw new GameError("BAD_REQUEST", TEAM_NAME_ERROR);
  return name;
}

/** Phases in which a revealed question's marking may still be corrected. */
export const CORRECTION_PHASES: RoomState["phase"][] = ["REVEAL_ANSWER", "LEADERBOARD"];

/** How long a move-to-new-device code works. */
export const TRANSFER_TTL_MS = 10 * 60 * 1000;

/** The room's secret seed (rooms made before it existed fall back to something stable). */
export function seedOf(state: Pick<RoomState, "secret_seed" | "room_code" | "created_at">): string {
  return state.secret_seed ?? `${state.room_code}-${state.created_at}`;
}

export function toPublicQuestion(q: BankQuestion, index: number, total: number, pack: PackInfo, seed = ""): PublicQuestion {
  const seq = isSequenceType(q.type) ? publicSequence(q, seed) : null;
  return {
    question_id: q.question_id,
    index,
    total,
    type: q.type,
    question_text: q.question_text,
    media_url: q.media_url ?? null,
    media_type: q.media_type ?? null,
    // Pictures go to phones by default (people at the back can't see the projector).
    // Audio and video stay on the stage unless asked for.
    show_media_on_player: q.show_media_on_player ?? (q.media_type === "image" || (!!q.media_url && !q.media_type)),
    // Ordering / matching: shuffled, with display letters. Everything else: as written.
    choices: seq ? seq.choices : q.choices ? q.choices.map((c) => ({ ...c })) : null,
    match_left: seq ? seq.match_left : null,
    // Parts go to the screens without their answers.
    sub_questions:
      q.type === "SUB_QUESTIONS_TEXT"
        ? (q.sub_questions ?? []).map((sq, i) => ({
            sub_id: sq.sub_id,
            prompt: sq.prompt,
            points: subQuestionPoints(q, q.base_points ?? pack.default_base_points)[i],
          }))
        : null,
    time_limit_sec: q.time_limit_sec ?? pack.default_time_limit_sec,
    // correct_answers_array, explanation, text_matching: deliberately omitted
  };
}

export function toPublicSnapshot(state: RoomState, now: number): PublicSnapshot {
  const { question_ids, secret_seed, ...rest } = state;
  void secret_seed; // server-only
  return { ...rest, total_questions: question_ids.length, server_now: now };
}

/** Rejects malformed answers before they are stored. Returns a cleaned copy. */
export function validateAnswerShape(q: PublicQuestion, answer: unknown): string[] | null {
  if (!Array.isArray(answer) || !answer.every((a) => typeof a === "string")) return null;
  if (q.type === "SUB_QUESTIONS_TEXT") {
    // One entry per part, in order. Blank parts are allowed; an all-blank answer is not.
    const n = q.sub_questions?.length ?? 0;
    if (answer.length !== n) return null;
    const cleaned = answer.map((a) => a.trim());
    if (cleaned.some((a) => a.length > 200) || cleaned.every((a) => a === "")) return null;
    return cleaned;
  }
  if (q.type === "TEXT_INPUT") {
    if (answer.length !== 1) return null;
    const text = answer[0].trim();
    return text.length > 0 && text.length <= 200 ? [text] : null;
  }
  const valid = new Set((q.choices ?? []).map((c) => c.choice_id));
  if (q.type === "ORDERING") {
    // Every item exactly once, in the team's order.
    if (answer.length !== valid.size || new Set(answer).size !== answer.length || !answer.every((a) => valid.has(a as never))) return null;
    return [...answer];
  }
  if (q.type === "MATCHING") {
    // One entry per left-hand item: a display letter, or "" for blank. Not all blank.
    const n = q.match_left?.length ?? 0;
    if (answer.length !== n || !answer.every((a) => a === "" || valid.has(a as never)) || answer.every((a) => a === "")) return null;
    return [...answer];
  }
  const picked = [...new Set(answer)];
  if (!picked.every((a) => valid.has(a as never))) return null;
  if ((q.type === "MCQ_SINGLE" || q.type === "TRUE_FALSE") && picked.length !== 1) return null;
  if (q.type === "MCQ_MULTI" && picked.length < 1) return null;
  return picked.sort();
}
