import "server-only";
import type { PackInfo, QuestionBankRepo } from "@/lib/game/engine";
import type { BankQuestion } from "@/lib/game/types";
import type { ImportDoc } from "@/lib/bank/types";
import { slugify } from "@/lib/bank/rows";
import { getSupabaseAdmin } from "./supabase";

interface PackRow {
  quiz_pack_id: string;
  title: string;
  description: string | null;
  default_time_limit_sec: number;
  default_base_points: number;
  speed_tiers: PackInfo["speed_tiers"] | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface PackListItem extends PackRow {
  question_count: number;
}

function toPackInfo(r: PackRow): PackInfo {
  return {
    quiz_pack_id: r.quiz_pack_id,
    default_time_limit_sec: r.default_time_limit_sec,
    default_base_points: r.default_base_points,
    speed_tiers: r.speed_tiers ?? undefined,
  };
}

function dbError(what: string, e: { message: string; code?: string } | null): never {
  const hint =
    e?.code === "42P01" || /relation .* does not exist|Could not find the table/i.test(e?.message ?? "")
      ? " — the database tables are missing. Open the host dashboard (/admin) once and they'll be created automatically."
      : "";
  throw new Error(`${what}: ${e?.message ?? "unknown error"}${hint}`);
}

/** Small per-instance cache so START/REVEAL don't hit Postgres twice for the same row. */
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 20_000;
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export function clearBankCache() {
  cache.clear();
}

export class SupabaseBankRepo implements QuestionBankRepo {
  async getPack(packId: string): Promise<PackInfo | null> {
    return cached(`pack:${packId}`, async () => {
      const { data, error } = await getSupabaseAdmin().from("quiz_packs").select("*").eq("quiz_pack_id", packId).maybeSingle();
      if (error) dbError("Loading pack", error);
      return data ? toPackInfo(data as PackRow) : null;
    });
  }

  async getPackQuestionIds(packId: string): Promise<string[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("questions")
      .select("question_id")
      .eq("quiz_pack_id", packId)
      .order("position", { ascending: true })
      .order("question_id", { ascending: true });
    if (error) dbError("Loading pack questions", error);
    return (data ?? []).map((r: { question_id: string }) => r.question_id);
  }

  async getQuestion(questionId: string): Promise<BankQuestion | null> {
    return cached(`q:${questionId}`, async () => {
      const { data, error } = await getSupabaseAdmin().from("questions").select("data").eq("question_id", questionId).maybeSingle();
      if (error) dbError("Loading question", error);
      return data ? ((data as { data: BankQuestion }).data) : null;
    });
  }

  // ----- CMS ---------------------------------------------------------------

  async listPacks(): Promise<PackListItem[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("quiz_packs")
      .select("*, questions(count)")
      .order("updated_at", { ascending: false });
    if (error) dbError("Listing packs", error);
    return (data ?? []).map((r: PackRow & { questions: { count: number }[] }) => {
      const { questions, ...rest } = r;
      return { ...rest, question_count: questions?.[0]?.count ?? 0 };
    });
  }

  async getPackQuestions(packId: string): Promise<BankQuestion[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("questions")
      .select("data")
      .eq("quiz_pack_id", packId)
      .order("position", { ascending: true })
      .order("question_id", { ascending: true });
    if (error) dbError("Loading questions", error);
    return (data ?? []).map((r: { data: BankQuestion }) => r.data);
  }

  async existingPackIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const { data, error } = await getSupabaseAdmin().from("quiz_packs").select("quiz_pack_id").in("quiz_pack_id", ids);
    if (error) dbError("Checking packs", error);
    return new Set((data ?? []).map((r: { quiz_pack_id: string }) => r.quiz_pack_id));
  }

  async deletePack(packId: string): Promise<void> {
    const { error } = await getSupabaseAdmin().from("quiz_packs").delete().eq("quiz_pack_id", packId);
    if (error) dbError("Deleting pack", error);
    clearBankCache();
  }

  async deleteQuestion(questionId: string): Promise<void> {
    const { error } = await getSupabaseAdmin().from("questions").delete().eq("question_id", questionId);
    if (error) dbError("Deleting question", error);
    clearBankCache();
  }

  // ----- Editor ------------------------------------------------------------

  async createPack(title: string, defaultTime: number): Promise<PackListItem> {
    const db = getSupabaseAdmin();
    const base = slugify(title) || "pack";
    let id = base;
    for (let i = 2; (await this.existingPackIds([id])).size > 0; i++) id = `${base.slice(0, 44)}-${i}`;
    const { data, error } = await db
      .from("quiz_packs")
      .insert({ quiz_pack_id: id, title: title.trim(), default_time_limit_sec: defaultTime, default_base_points: 100 })
      .select("*")
      .single();
    if (error) dbError("Creating pack", error);
    clearBankCache();
    return { ...(data as PackRow), question_count: 0 };
  }

  async updatePack(packId: string, patch: { title?: string; description?: string | null; default_time_limit_sec?: number }): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("quiz_packs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("quiz_pack_id", packId);
    if (error) dbError("Updating pack", error);
    clearBankCache();
  }

  /** Sets the same time limit on every question in a pack. */
  async setAllTimes(packId: string, seconds: number): Promise<number> {
    const questions = await this.getPackQuestions(packId);
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();
    const rows = await Promise.all(
      questions.map(async (q) => {
        const { data } = await db.from("questions").select("position").eq("question_id", q.question_id).single();
        return {
          question_id: q.question_id,
          quiz_pack_id: packId,
          position: (data as { position: number } | null)?.position ?? 0,
          type: q.type,
          data: { ...q, time_limit_sec: seconds },
          updated_at: now,
        };
      }),
    );
    if (rows.length) {
      const { error } = await db.from("questions").upsert(rows, { onConflict: "question_id" });
      if (error) dbError("Updating times", error);
    }
    await this.updatePack(packId, { default_time_limit_sec: seconds });
    return rows.length;
  }

  /** Creates or updates one question. New questions go to the end of the pack. */
  async saveQuestion(q: BankQuestion): Promise<void> {
    const db = getSupabaseAdmin();
    const { data: existing, error: e1 } = await db
      .from("questions")
      .select("position, quiz_pack_id")
      .eq("question_id", q.question_id)
      .maybeSingle();
    if (e1) dbError("Loading question", e1);
    let position: number;
    const ex = existing as { position: number; quiz_pack_id: string } | null;
    if (ex && ex.quiz_pack_id === q.quiz_pack_id) {
      position = ex.position;
    } else {
      const { data, error } = await db
        .from("questions")
        .select("position")
        .eq("quiz_pack_id", q.quiz_pack_id)
        .order("position", { ascending: false })
        .limit(1);
      if (error) dbError("Reading positions", error);
      position = data && data.length ? (data[0] as { position: number }).position + 1 : 0;
    }
    const { order: _order, ...clean } = q;
    void _order;
    const { error } = await db.from("questions").upsert(
      { question_id: q.question_id, quiz_pack_id: q.quiz_pack_id, position, type: q.type, data: clean, updated_at: new Date().toISOString() },
      { onConflict: "question_id" },
    );
    if (error) dbError("Saving question", error);
    await db.from("quiz_packs").update({ updated_at: new Date().toISOString() }).eq("quiz_pack_id", q.quiz_pack_id);
    clearBankCache();
  }

  async reorder(packId: string, questionIds: string[]): Promise<void> {
    const db = getSupabaseAdmin();
    await Promise.all(
      questionIds.map(async (id, i) => {
        const { error } = await db.from("questions").update({ position: i }).eq("question_id", id).eq("quiz_pack_id", packId);
        if (error) dbError("Reordering", error);
      }),
    );
    clearBankCache();
  }

  /**
   * mode "replace": each pack in the file ends up containing exactly the
   * questions in the file. mode "append": questions are upserted and new ones
   * go to the end of the pack.
   */
  async importDoc(doc: ImportDoc, mode: "replace" | "append"): Promise<{ packs: number; questions: number }> {
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();

    if (doc.quiz_packs.length) {
      const { error } = await db.from("quiz_packs").upsert(
        doc.quiz_packs.map((p) => ({
          quiz_pack_id: p.quiz_pack_id,
          title: p.title,
          description: p.description ?? null,
          default_time_limit_sec: p.default_time_limit_sec ?? 30,
          default_base_points: p.default_base_points ?? 100,
          speed_tiers: p.speed_tiers ?? null,
          tags: p.tags ?? [],
          updated_at: now,
        })),
        { onConflict: "quiz_pack_id" },
      );
      if (error) dbError("Saving packs", error);
    }

    const byPack = new Map<string, BankQuestion[]>();
    for (const q of doc.questions) {
      const list = byPack.get(q.quiz_pack_id) ?? [];
      list.push(q);
      byPack.set(q.quiz_pack_id, list);
    }

    let count = 0;
    for (const [packId, qs] of byPack) {
      let offset = 0;
      if (mode === "replace") {
        const keep = qs.map((q) => q.question_id);
        const { error } = await db
          .from("questions")
          .delete()
          .eq("quiz_pack_id", packId)
          .not("question_id", "in", `(${keep.map((id) => `"${id}"`).join(",")})`);
        if (error) dbError("Clearing old questions", error);
      } else {
        const { data, error } = await db
          .from("questions")
          .select("position")
          .eq("quiz_pack_id", packId)
          .order("position", { ascending: false })
          .limit(1);
        if (error) dbError("Reading positions", error);
        offset = data && data.length ? (data[0] as { position: number }).position + 1 : 0;
      }

      const rows = qs.map((q, i) => ({
        question_id: q.question_id,
        quiz_pack_id: packId,
        position: q.order ?? offset + i,
        type: q.type,
        data: q,
        updated_at: now,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from("questions").upsert(rows.slice(i, i + 500), { onConflict: "question_id" });
        if (error) dbError("Saving questions", error);
      }
      count += rows.length;
      await db.from("quiz_packs").update({ updated_at: now }).eq("quiz_pack_id", packId);
    }

    clearBankCache();
    return { packs: byPack.size, questions: count };
  }
}
