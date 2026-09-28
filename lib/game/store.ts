/**
 * Live-room storage. The engine only talks to this interface: Upstash Redis
 * in production, an in-memory map in tests.
 *
 * Redis key layout (all keys expire 12h after the room was last changed):
 *
 *   rooms:index                     SET     room codes (admin dashboard)
 *   room:{code}:state               STRING  JSON RoomState (includes running leaderboard)
 *   room:{code}:version             STRING  RoomState.version, for compare-and-set
 *   room:{code}:teams               HASH    team_id -> JSON Team
 *   room:{code}:team_names          HASH    lower(name) -> team_id   (uniqueness via HSETNX)
 *   room:{code}:answers:{qIndex}    HASH    team_id -> JSON Submission (first write wins via HSETNX)
 *
 * Why this copes with everyone answering at once:
 *   - A submission is ONE HSETNX: no read-modify-write, no lock, no contention
 *     between teams, and double-taps are rejected atomically.
 *   - Scores don't change while answers arrive. They're computed once at
 *     REVEAL and written with the state in one versioned write.
 *   - Postgres (the question bank) is never touched on the answer path.
 */
import type { RoomState, Submission, Team } from "./types";

export interface RoomSummary {
  room_code: string;
  phase: RoomState["phase"];
  created_at: number;
  quiz_pack_id: string | null;
}

export interface RoomStore {
  getState(code: string): Promise<RoomState | null>;
  createState(state: RoomState): Promise<boolean>;
  compareAndSetState(code: string, expectedVersion: number, next: RoomState): Promise<boolean>;
  listRooms(): Promise<RoomSummary[]>;
  deleteRoom(code: string): Promise<void>;

  addTeam(code: string, team: Team, maxTeams: number): Promise<"OK" | "NAME_TAKEN" | "ROOM_FULL">;
  getTeam(code: string, teamId: string): Promise<Team | null>;
  getTeams(code: string): Promise<Team[]>;
  saveTeam(code: string, team: Team): Promise<void>;

  putSubmissionIfAbsent(code: string, sub: Submission): Promise<boolean>;
  getSubmission(code: string, qIndex: number, teamId: string): Promise<Submission | null>;
  getSubmissions(code: string, qIndex: number): Promise<Submission[]>;
  countSubmissions(code: string, qIndex: number): Promise<number>;
}

// ---------------------------------------------------------------------------
// Redis implementation. RedisLike matches @upstash/redis created with
// { automaticDeserialization: false } (values come back as raw strings).
// ---------------------------------------------------------------------------

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { nx?: boolean; ex?: number }): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, kv: Record<string, string>): Promise<number>;
  hsetnx(key: string, field: string, value: string): Promise<number>;
  hvals(key: string): Promise<string[]>;
  hlen(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  incr(key: string): Promise<number>;
  sadd(key: string, member: string): Promise<number>;
  srem(key: string, member: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export const ROOM_TTL_SEC = 60 * 60 * 12;
const k = {
  index: "rooms:index",
  state: (c: string) => `room:${c}:state`,
  version: (c: string) => `room:${c}:version`,
  teams: (c: string) => `room:${c}:teams`,
  names: (c: string) => `room:${c}:team_names`,
  answers: (c: string, q: number) => `room:${c}:answers:${q}`,
};

/**
 * KEYS[1] = version key, KEYS[2] = state key
 * ARGV[1] = expected version, ARGV[2] = new version, ARGV[3] = new state JSON, ARGV[4] = ttl
 */
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if (not cur) or (cur ~= ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[4]))
redis.call('SET', KEYS[2], ARGV[3], 'EX', tonumber(ARGV[4]))
return 1`;

export class RedisRoomStore implements RoomStore {
  constructor(private r: RedisLike) {}

  async getState(code: string) {
    const raw = await this.r.get(k.state(code));
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }

  async createState(state: RoomState) {
    const c = state.room_code;
    const claimed = await this.r.set(k.version(c), String(state.version), { nx: true, ex: ROOM_TTL_SEC });
    if (claimed !== "OK") return false;
    await this.r.set(k.state(c), JSON.stringify(state), { ex: ROOM_TTL_SEC });
    await this.r.sadd(k.index, c);
    return true;
  }

  async compareAndSetState(code: string, expectedVersion: number, next: RoomState) {
    const res = await this.r.eval(CAS_SCRIPT, [k.version(code), k.state(code)], [
      String(expectedVersion),
      String(next.version),
      JSON.stringify(next),
      String(ROOM_TTL_SEC),
    ]);
    if (Number(res) !== 1) return false;
    // Keep the other room keys alive as long as the state.
    await Promise.all([
      this.r.expire(k.teams(code), ROOM_TTL_SEC),
      this.r.expire(k.names(code), ROOM_TTL_SEC),
    ]);
    return true;
  }

  async listRooms() {
    const codes = await this.r.smembers(k.index);
    if (codes.length === 0) return [];
    const raws = await this.r.mget(...codes.map(k.state));
    const out: RoomSummary[] = [];
    await Promise.all(
      codes.map(async (c, i) => {
        const raw = raws[i];
        if (!raw) {
          await this.r.srem(k.index, c); // expired
          return;
        }
        const s = JSON.parse(raw) as RoomState;
        out.push({ room_code: s.room_code, phase: s.phase, created_at: s.created_at, quiz_pack_id: s.quiz_pack_id });
      }),
    );
    return out.sort((a, b) => b.created_at - a.created_at);
  }

  async deleteRoom(code: string) {
    const state = await this.getState(code);
    const answerKeys = state ? state.question_ids.map((_, i) => k.answers(code, i)) : [];
    await this.r.del(k.state(code), k.version(code), k.teams(code), k.names(code), ...answerKeys);
    await this.r.srem(k.index, code);
  }

  async addTeam(code: string, team: Team, maxTeams: number) {
    if ((await this.r.hlen(k.teams(code))) >= maxTeams) return "ROOM_FULL" as const;
    const claimed = await this.r.hsetnx(k.names(code), team.name.trim().toLowerCase(), team.team_id);
    if (!claimed) return "NAME_TAKEN" as const;
    await this.r.hset(k.teams(code), { [team.team_id]: JSON.stringify(team) });
    await Promise.all([this.r.expire(k.teams(code), ROOM_TTL_SEC), this.r.expire(k.names(code), ROOM_TTL_SEC)]);
    return "OK" as const;
  }

  async getTeam(code: string, teamId: string) {
    const raw = await this.r.hget(k.teams(code), teamId);
    return raw ? (JSON.parse(raw) as Team) : null;
  }

  async getTeams(code: string) {
    return (await this.r.hvals(k.teams(code))).map((v) => JSON.parse(v) as Team);
  }

  async saveTeam(code: string, team: Team) {
    await this.r.hset(k.teams(code), { [team.team_id]: JSON.stringify(team) });
  }

  async putSubmissionIfAbsent(code: string, sub: Submission) {
    const key = k.answers(code, sub.question_index);
    const ok = await this.r.hsetnx(key, sub.team_id, JSON.stringify(sub));
    if (ok === 1) await this.r.expire(key, ROOM_TTL_SEC);
    return ok === 1;
  }

  async getSubmission(code: string, qIndex: number, teamId: string) {
    const raw = await this.r.hget(k.answers(code, qIndex), teamId);
    return raw ? (JSON.parse(raw) as Submission) : null;
  }

  async getSubmissions(code: string, qIndex: number) {
    return (await this.r.hvals(k.answers(code, qIndex))).map((v) => JSON.parse(v) as Submission);
  }

  async countSubmissions(code: string, qIndex: number) {
    return this.r.hlen(k.answers(code, qIndex));
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation for tests and local dev without Redis.
// ---------------------------------------------------------------------------

export class MemoryRoomStore implements RoomStore {
  private states = new Map<string, string>();
  private teams = new Map<string, Map<string, Team>>();
  private names = new Map<string, Map<string, string>>();
  private answers = new Map<string, Map<string, Submission>>();

  async getState(code: string) {
    const raw = this.states.get(code);
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }
  async createState(state: RoomState) {
    if (this.states.has(state.room_code)) return false;
    this.states.set(state.room_code, JSON.stringify(state));
    return true;
  }
  async compareAndSetState(code: string, expectedVersion: number, next: RoomState) {
    const cur = await this.getState(code);
    if (!cur || cur.version !== expectedVersion) return false;
    this.states.set(code, JSON.stringify(next));
    return true;
  }
  async listRooms() {
    return [...this.states.values()]
      .map((raw) => JSON.parse(raw) as RoomState)
      .map((s) => ({ room_code: s.room_code, phase: s.phase, created_at: s.created_at, quiz_pack_id: s.quiz_pack_id }));
  }
  async deleteRoom(code: string) {
    this.states.delete(code);
    this.teams.delete(code);
    this.names.delete(code);
  }
  async addTeam(code: string, team: Team, maxTeams: number) {
    const teams = this.teams.get(code) ?? new Map<string, Team>();
    const names = this.names.get(code) ?? new Map<string, string>();
    if (teams.size >= maxTeams) return "ROOM_FULL" as const;
    const key = team.name.trim().toLowerCase();
    if (names.has(key)) return "NAME_TAKEN" as const;
    names.set(key, team.team_id);
    teams.set(team.team_id, team);
    this.teams.set(code, teams);
    this.names.set(code, names);
    return "OK" as const;
  }
  async getTeam(code: string, teamId: string) {
    const t = this.teams.get(code)?.get(teamId);
    return t ? (JSON.parse(JSON.stringify(t)) as Team) : null;
  }
  async getTeams(code: string) {
    return [...(this.teams.get(code)?.values() ?? [])].map((t) => JSON.parse(JSON.stringify(t)) as Team);
  }
  async saveTeam(code: string, team: Team) {
    this.teams.get(code)?.set(team.team_id, team);
  }
  async putSubmissionIfAbsent(code: string, sub: Submission) {
    const key = `${code}:${sub.question_index}`;
    const m = this.answers.get(key) ?? new Map<string, Submission>();
    if (m.has(sub.team_id)) return false;
    m.set(sub.team_id, sub);
    this.answers.set(key, m);
    return true;
  }
  async getSubmission(code: string, qIndex: number, teamId: string) {
    return this.answers.get(`${code}:${qIndex}`)?.get(teamId) ?? null;
  }
  async getSubmissions(code: string, qIndex: number) {
    return [...(this.answers.get(`${code}:${qIndex}`)?.values() ?? [])];
  }
  async countSubmissions(code: string, qIndex: number) {
    return this.answers.get(`${code}:${qIndex}`)?.size ?? 0;
  }
}
