import "server-only";
import { createHash } from "node:crypto";
import type { CompetitionDetail, CompetitionEvent, CompetitionQuestion, CompetitionRecord, CompetitionSummary } from "@/lib/competition/types";
import { getSupabaseAdmin } from "./supabase";

function check<T>(what: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error) {
    const missing = /does not exist|Could not find the table|schema cache/i.test(res.error.message);
    throw new Error(missing ? "The competition log tables aren't set up yet. Open the host dashboard (/admin) once and they'll be created automatically." : `${what}: ${res.error.message}`);
  }
  return res.data;
}

export async function listCompetitions(): Promise<CompetitionSummary[]> {
  const rows = check(
    "list competitions",
    await getSupabaseAdmin()
      .from("competitions")
      .select("competition_id, room_code, pack_title, status, created_at, updated_at, finished_at, question_total, questions_played, teams, standings, qualification")
      .order("created_at", { ascending: false })
      .limit(500),
  ) as (CompetitionRecord & { standings: CompetitionRecord["standings"] })[];
  return rows.map((r) => ({
    competition_id: r.competition_id,
    room_code: r.room_code,
    pack_title: r.pack_title,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
    finished_at: r.finished_at,
    question_total: r.question_total,
    questions_played: r.questions_played,
    team_count: (r.teams ?? []).length,
    qualified_count: r.qualification ? r.qualification.qualified_team_ids.length : null,
    leader: r.standings?.[0]?.name ?? null,
  }));
}

/** Last change time, so the page can skip re-downloading an unchanged log. */
export async function competitionVersion(id: string): Promise<string | null> {
  const row = check("read competition", await getSupabaseAdmin().from("competitions").select("updated_at").eq("competition_id", id).maybeSingle()) as { updated_at: string } | null;
  return row?.updated_at ?? null;
}

export async function getCompetition(id: string): Promise<CompetitionDetail | null> {
  const db = getSupabaseAdmin();
  const competition = check("read competition", await db.from("competitions").select("*").eq("competition_id", id).maybeSingle()) as CompetitionRecord | null;
  if (!competition) return null;
  const [questions, events] = await Promise.all([
    check("read questions", await db.from("competition_questions").select("*").eq("competition_id", id).order("question_index", { ascending: true }).limit(1000)),
    check("read events", await db.from("competition_events").select("event_id, at, kind, question_index, detail").eq("competition_id", id).order("event_id", { ascending: true }).limit(5000)),
  ]);
  const qs = (questions as (CompetitionQuestion & { competition_id?: string })[]).map(({ competition_id: _drop, ...q }) => q as CompetitionQuestion);
  const ev = events as CompetitionEvent[];
  return { competition, questions: qs, events: ev, fingerprint: fingerprint(competition, qs, ev) };
}

export async function deleteCompetition(id: string) {
  // Questions and events are removed with it (on delete cascade).
  check("delete competition", await getSupabaseAdmin().from("competitions").delete().eq("competition_id", id));
}

/** JSON with keys sorted at every level, so the same data always gives the same text. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/** 12 characters, e.g. 7F3A-91C2-0B4D. Covers everything except the "last updated" time. */
export function fingerprint(c: CompetitionRecord, qs: CompetitionQuestion[], ev: CompetitionEvent[]): string {
  const { updated_at: _u, ...core } = c;
  const hex = createHash("sha256").update(stableStringify({ core, qs, ev })).digest("hex").slice(0, 12).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}
