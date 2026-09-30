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
  RevealPayload,
  RoomSettings,
  RoomState,
  ScoreRow,
  SpeedTier,
  Submission,
  Team,
} from "./types";
import { GameError, assertCanApply, createInitialState, isAcceptingAnswers, transition } from "./state-machine";
import type { ResolvedEvent } from "./state-machine";
import { effectiveChoiceKey, rankTeams, scoreSubmission, subQuestionPoints } from "./scoring";
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
  | { ok: false; reason: "NOT_ACCEPTING" | "ALREADY_ANSWERED" | "INVALID_ANSWER" | "FROZEN" | "UNKNOWN_TEAM" };

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
      const state = createInitialState(code, this.clock.now(), settings);
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
        const question = toPublicQuestion(q, index, state.question_ids.length, pack);
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
  private async scoreCurrentQuestion(state: RoomState): Promise<{
    reveal: RevealPayload;
    leaderboard: ScoreRow[];
    question: BankQuestion;
    pack: PackInfo;
    answers: AnswerRecord[];
    teams: Team[];
    overrides: MarkOverride[];
  }> {
    const qIndex = state.current_question_index;
    const [q, pack, teams, subs, overrides] = await Promise.all([
      this.bank.getQuestion(state.question_ids[qIndex]),
      this.bank.getPack(state.quiz_pack_id!),
      this.store.getTeams(state.room_code),
      this.store.getSubmissions(state.room_code, qIndex),
      this.store.getOverrides(state.room_code, qIndex),
    ]);
    if (!q || !pack) throw new GameError("BAD_REQUEST", "Question or pack missing from bank");

    const byTeam = new Map(subs.map((s) => [s.team_id, s]));
    const tallies: Record<string, Tally> = {};
    for (const row of state.leaderboard) {
      tallies[row.team_id] = {
        score: row.score,
        correct_count: row.correct_count,
        total_correct_time_ms: row.total_correct_time_ms,
      };
    }

    const results: RevealPayload["results"] = {};
    const distribution: Record<string, number> | null = q.type === "TEXT_INPUT" || q.type === "SUB_QUESTIONS_TEXT" ? null : {};
    for (const c of q.choices ?? []) distribution![c.choice_id] = 0;
    const basePoints = q.base_points ?? pack.default_base_points;
    const answers: AnswerRecord[] = [];

    for (const team of teams) {
      const sub = byTeam.get(team.team_id);
      const voided = team.frozen_for_question === qIndex;
      const r = scoreSubmission(
        q,
        team.team_id,
        sub,
        state.question_started_at!,
        voided,
        { base_points: pack.default_base_points, speed_tiers: pack.speed_tiers },
        overrides,
      );
      results[team.team_id] = {
        correct: r.correct,
        points: r.points,
        fraction: r.fraction,
        answered: r.answered,
        voided_by_anti_cheat: r.voided_by_anti_cheat,
        ...(r.sub_correct ? { sub_correct: r.sub_correct } : {}),
      };
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
        points: r.points,
        // Locked out by anti-cheat for this question (whether or not an answer had arrived).
        voided,
        marking: sub ? explainAnswer(q, sub.answer, basePoints, overrides) : null,
        flags: team.flags.filter((f) => f.question_index === qIndex),
      });
    }

    const isText = q.type === "TEXT_INPUT";
    const isSub = q.type === "SUB_QUESTIONS_TEXT";
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
    return {
      reveal: {
        question_index: qIndex,
        question_id: q.question_id,
        type: q.type,
        correct_display: isText ? [q.correct_answers_array[0]] : isSub ? (sub_reveal ?? []).map((x) => x.answer) : effectiveChoiceKey(q, overrides),
        accepted_aliases: isText ? q.correct_answers_array.slice(1) : [],
        host_accepted: isText ? hostAccepted(null) : [],
        review_changes: applied.length,
        sub_reveal,
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
    // Same as the automatic marking = no change needed.
    const verdict = input.verdict === group.auto ? null : input.verdict;
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
    const cutoffRank = standings[Math.min(qualifyCount, standings.length) - 1]?.rank ?? 0;
    return {
      qualification: {
        qualify_count: qualifyCount,
        qualified_team_ids: standings.filter((r) => r.rank <= cutoffRank).map((r) => r.team_id),
        final_standings: standings,
      },
      teams,
    };
  }

  // ----- Player actions ----------------------------------------------------

  async joinTeam(code: string, rawName: string): Promise<Team> {
    const state = await this.getState(code);
    if (state.phase === "ENDED" || state.phase === "QUALIFICATION_REVEAL") {
      throw new GameError("BAD_REQUEST", "This game has finished");
    }
    const name = rawName.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 32) throw new GameError("BAD_REQUEST", "Team name must be 2-32 characters");

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
  async submitAnswer(code: string, teamId: string, answer: string[]): Promise<AnswerResult> {
    const now = this.clock.now(); // stamp on arrival, before any awaits
    const [state, team] = await Promise.all([this.getState(code), this.store.getTeam(code, teamId)]);
    if (!team) return { ok: false, reason: "UNKNOWN_TEAM" };
    if (!isAcceptingAnswers(state, now)) return { ok: false, reason: "NOT_ACCEPTING" };
    if (team.frozen_for_question === state.current_question_index) return { ok: false, reason: "FROZEN" };

    const cleaned = validateAnswerShape(state.current_question!, answer);
    if (!cleaned) return { ok: false, reason: "INVALID_ANSWER" };

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
    kind: "FOCUS_LOST" | "PASTE_ATTEMPT" = "FOCUS_LOST",
  ): Promise<{ flagged: boolean; frozen: boolean }> {
    const [state, team] = await Promise.all([this.getState(code), this.store.getTeam(code, teamId)]);
    if (!team || state.phase !== "PLAYING") return { flagged: false, frozen: false };
    const duration = Math.max(0, Math.min(Number(durationMs) || 0, 10 * 60 * 1000));
    if (kind === "FOCUS_LOST" && duration < state.settings.focus_violation_ms) return { flagged: false, frozen: false };

    const qIndex = state.current_question_index;
    team.flags.push({ question_index: qIndex, kind, duration_ms: duration, at: this.clock.now() });

    // Freeze only for leaving the page before answering. Paste attempts are
    // blocked in the browser anyway, so they're just recorded for the admin.
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
        my_answer: sub?.answer ?? null,
        frozen: team.frozen_for_question === state.current_question_index,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toPublicQuestion(q: BankQuestion, index: number, total: number, pack: PackInfo): PublicQuestion {
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
    choices: q.choices ? q.choices.map((c) => ({ ...c })) : null,
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
  const { question_ids, ...rest } = state;
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
  const picked = [...new Set(answer)];
  if (!picked.every((a) => valid.has(a as never))) return null;
  if (q.type === "MCQ_SINGLE" && picked.length !== 1) return null;
  if (q.type === "MCQ_MULTI" && picked.length < 1) return null;
  return picked.sort();
}
