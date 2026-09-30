import "server-only";
import type { GameRecorder, RecordInput, ReviewEvent } from "@/lib/game/recorder";
import { competitionId, questionStats } from "@/lib/game/recorder";
import type { RoomState, Team } from "@/lib/game/types";
import { getSupabaseAdmin } from "./supabase";
import { ensureDatabaseTables } from "./db-setup";

/**
 * Writes the competition log to Supabase as the game runs (see
 * supabase/setup.sql: competitions, competition_questions, competition_events).
 * Each reveal is saved straight away, so nothing is lost if the game is cut short.
 */
const iso = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

const TABLE_MISSING = /does not exist|Could not find the table|schema cache/i;

function check(what: string, res: { error: { message: string } | null }) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

function teamList(teams: Team[]) {
  return [...teams]
    .sort((a, b) => a.joined_at - b.joined_at)
    .map((t) => ({ team_id: t.team_id, name: t.name, joined_at: iso(t.joined_at), flags: t.flags }));
}

export class SupabaseRecorder implements GameRecorder {
  private packTitles = new Map<string, string>();

  async onTransition(input: RecordInput) {
    await this.withTables(() => this.write(input));
  }

  async onRoomDeleted(state: RoomState, at: number) {
    await this.withTables(async () => {
      const db = getSupabaseAdmin();
      const id = competitionId(state);
      const { data } = await db.from("competitions").select("status").eq("competition_id", id).maybeSingle();
      if (!data) return; // never got as far as choosing a pack
      if (data.status === "LIVE") {
        check("close competition", await db.from("competitions").update({ status: "FINISHED", finished_at: iso(at), updated_at: iso(at) }).eq("competition_id", id));
      }
      await this.event(id, at, "ROOM_DELETED", null, null);
    });
  }

  /** A host marking change during the review: logged straight away, before the reveal. */
  async onReview(state: RoomState, at: number, ev: ReviewEvent) {
    await this.withTables(() => this.event(competitionId(state), at, "MARK_CHANGED", ev.question_index, ev));
  }

  /** Databases set up before the log existed get the new tables on first use. */
  private async withTables(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      if (!TABLE_MISSING.test((e as Error).message)) throw e;
      const setup = await ensureDatabaseTables();
      if (!setup.ok) throw new Error(setup.message);
      await new Promise((r) => setTimeout(r, 1500)); // let Supabase's API see the new tables
      await fn();
    }
  }

  private async packTitle(packId: string | null) {
    if (!packId) return null;
    if (!this.packTitles.has(packId)) {
      const { data } = await getSupabaseAdmin().from("quiz_packs").select("title").eq("quiz_pack_id", packId).maybeSingle();
      this.packTitles.set(packId, (data?.title as string) ?? packId);
    }
    return this.packTitles.get(packId)!;
  }

  private async event(id: string, at: number, kind: string, questionIndex: number | null, detail: unknown) {
    const db = getSupabaseAdmin();
    check("log event", await db.from("competition_events").insert({ competition_id: id, at: iso(at), kind, question_index: questionIndex, detail }));
    // Lets open log pages know something new was recorded.
    check("touch competition", await db.from("competitions").update({ updated_at: iso(Date.now()) }).eq("competition_id", id));
  }

  private async upsertCompetition(s: RoomState, at: number) {
    check(
      "save competition",
      await getSupabaseAdmin()
        .from("competitions")
        .upsert(
          {
            competition_id: competitionId(s),
            room_code: s.room_code,
            pack_id: s.quiz_pack_id,
            pack_title: await this.packTitle(s.quiz_pack_id),
            status: "LIVE",
            created_at: iso(s.created_at),
            updated_at: iso(at),
            question_total: s.question_ids.length,
            settings: s.settings,
          },
          { onConflict: "competition_id" },
        ),
    );
  }

  private async write({ command, prev, next, at, question, pack, answers, teams, overrides }: RecordInput) {
    const db = getSupabaseAdmin();
    const id = competitionId(next);
    const qi = next.current_question_index >= 0 ? next.current_question_index : null;

    switch (command.type) {
      case "SELECT_PACK":
        await this.upsertCompetition(next, at);
        await this.event(id, at, "PACK_SELECTED", null, { pack_id: next.quiz_pack_id, questions: next.question_ids.length });
        return;

      case "START_QUESTION": {
        await this.upsertCompetition(next, at);
        const cq = next.current_question!;
        check(
          "save question",
          await db.from("competition_questions").upsert(
            {
              competition_id: id,
              question_index: cq.index,
              question,
              effective: {
                time_limit_sec: cq.time_limit_sec,
                base_points: question?.base_points ?? pack?.default_base_points ?? 100,
                speed_tiers: question?.speed_tiers ?? pack?.speed_tiers ?? null,
                time_override: command.time_limit_sec ?? null,
              },
              started_at: iso(next.question_started_at),
              planned_end_at: iso(next.question_ends_at),
            },
            { onConflict: "competition_id,question_index" },
          ),
        );
        await this.event(id, at, "QUESTION_STARTED", cq.index, { time_limit_sec: cq.time_limit_sec, time_override: command.time_limit_sec ?? null });
        return;
      }

      case "ADJUST_TIME":
        check("adjust time", await db.from("competition_questions").update({ planned_end_at: iso(next.question_ends_at) }).eq("competition_id", id).eq("question_index", qi));
        await this.event(id, at, "TIME_ADJUSTED", qi, { delta_sec: command.delta_sec, new_end: iso(next.question_ends_at) });
        return;

      case "END_QUESTION":
      case "TIMER_EXPIRED": {
        const by = command.type === "END_QUESTION" ? "HOST" : "TIMER";
        check("close question", await db.from("competition_questions").update({ closed_at: iso(at), closed_by: by }).eq("competition_id", id).eq("question_index", qi));
        await this.event(id, at, by === "HOST" ? "ANSWERS_LOCKED_BY_HOST" : "TIME_UP", qi, { was_due: iso(prev.question_ends_at) });
        return;
      }

      case "REVEAL_ANSWER": {
        const stats = question && answers ? questionStats(question, answers, overrides ?? []) : null;
        check(
          "save results",
          await db.from("competition_questions").update({ revealed_at: iso(at), results: answers ?? [], stats }).eq("competition_id", id).eq("question_index", qi),
        );
        check(
          "save standings",
          await db
            .from("competitions")
            .update({ teams: teamList(teams ?? []), standings: next.leaderboard, questions_played: (qi ?? -1) + 1, updated_at: iso(at) })
            .eq("competition_id", id),
        );
        await this.event(id, at, "ANSWER_REVEALED", qi, stats ? { correct: stats.correct, answered: stats.answered, marking_changes: overrides?.length ?? 0 } : null);
        return;
      }

      case "MEDIA":
        await this.event(id, at, "MEDIA_CONTROL", qi, { action: command.action });
        return;

      case "SHOW_LEADERBOARD":
        await this.event(id, at, "LEADERBOARD_SHOWN", qi, null);
        return;

      case "SHOW_QUALIFICATION":
        check(
          "save qualification",
          await db
            .from("competitions")
            .update({ qualification: next.qualification, standings: next.qualification?.final_standings ?? next.leaderboard, teams: teamList(teams ?? []), updated_at: iso(at) })
            .eq("competition_id", id),
        );
        await this.event(id, at, "QUALIFIED_TEAMS_SHOWN", qi, {
          qualify_count: command.qualify_count,
          qualified: next.qualification?.qualified_team_ids.length ?? 0,
        });
        return;

      case "TERMINATE": {
        const { data } = await db.from("competitions").select("competition_id").eq("competition_id", id).maybeSingle();
        if (!data) return; // ended before a pack was chosen: nothing to keep
        check(
          "finish competition",
          await db
            .from("competitions")
            .update({ status: "FINISHED", finished_at: iso(at), updated_at: iso(at), ...(teams ? { teams: teamList(teams) } : {}) })
            .eq("competition_id", id),
        );
        await this.event(id, at, "GAME_ENDED", qi, null);
        return;
      }
    }
  }
}
