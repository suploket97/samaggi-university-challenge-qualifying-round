"use client";
import { useCallback, useEffect, useState } from "react";
import type { BankQuestion } from "@/lib/game/types";
import type { ImportDoc, ImportIssue } from "@/lib/bank/types";
import { normalizeJsonImport, rowsToImport, type Row } from "@/lib/bank/rows";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, ErrorNote, Spinner, cx, inputCls } from "@/components/ui";
import { choiceTileStyle } from "@/components/game";
import { AdminShell } from "./AdminShell";
import { GRIP, arrayMove, useSortable } from "@/lib/client/useSortable";
import { QuestionEditor, TIME_PRESETS } from "./QuestionEditor";

interface PackItem {
  quiz_pack_id: string;
  title: string;
  description: string | null;
  default_time_limit_sec: number;
  question_count: number;
  updated_at: string;
}

const TYPE_LABEL: Record<string, string> = { MCQ_SINGLE: "One answer", MCQ_MULTI: "Several answers", TEXT_INPUT: "Typed answer", SUB_QUESTIONS_TEXT: "Sub-questions" };

export function BankManager() {
  const [packs, setPacks] = useState<PackItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const loadPacks = useCallback(async () => {
    try {
      const r = await api<{ packs: PackItem[] }>("/api/admin/packs");
      setPacks(r.packs);
      setSelected((s) => (s && r.packs.some((p) => p.quiz_pack_id === s) ? s : r.packs[0]?.quiz_pack_id ?? null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  async function createPack(e: React.FormEvent) {
    e.preventDefault();
    if (newTitle.trim().length < 2) return;
    setCreating(true);
    setError(null);
    try {
      const r = await api<{ pack: PackItem }>("/api/admin/packs", { method: "POST", json: { title: newTitle, default_time_limit_sec: 30 } });
      setNewTitle("");
      await loadPacks();
      setSelected(r.pack.quiz_pack_id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const pack = packs?.find((p) => p.quiz_pack_id === selected) ?? null;

  return (
    <AdminShell title="Question bank">
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-2 grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="font-headline text-lg font-bold">Packs</h2>
            {!packs ? (
              <Spinner className="mt-3" />
            ) : packs.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No packs yet. Create one below, or import the sample pack.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {packs.map((p) => (
                  <li key={p.quiz_pack_id}>
                    <button
                      onClick={() => setSelected(p.quiz_pack_id)}
                      className={cx(
                        "w-full rounded-xl px-3 py-2 text-left transition",
                        p.quiz_pack_id === selected ? "bg-gold/15 ring-1 ring-gold/50" : "hover:bg-white/5",
                      )}
                    >
                      <span className="block truncate font-semibold">{p.title}</span>
                      <span className="text-xs text-muted">{p.question_count} questions · {p.default_time_limit_sec}s default</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={createPack} className="mt-4 flex gap-2 border-t border-line pt-4">
              <input className={inputCls("h-10")} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New pack name" maxLength={120} />
              <Button size="sm" className="h-10" type="submit" loading={creating} disabled={newTitle.trim().length < 2}>Create</Button>
            </form>
          </Card>

          <Card className="p-4">
            <button className="flex w-full items-center justify-between text-left" onClick={() => setShowImport((v) => !v)}>
              <span>
                <span className="block font-headline text-lg font-bold">Import from a spreadsheet</span>
                <span className="text-xs text-muted">Optional: CSV, Excel or JSON</span>
              </span>
              <span className="text-muted">{showImport ? "▾" : "▸"}</span>
            </button>
            {showImport ? <ImportPanel onImported={loadPacks} /> : null}
          </Card>
        </div>

        {pack ? <PackEditor key={pack.quiz_pack_id} pack={pack} onChanged={loadPacks} /> : (
          <Card className="grid min-h-64 place-items-center p-8 text-center text-muted">
            <p>Create a pack on the left to start adding questions.</p>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// One pack: settings + question list + editor
// ---------------------------------------------------------------------------

function PackEditor({ pack, onChanged }: { pack: PackItem; onChanged: () => void }) {
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null);
  const [editing, setEditing] = useState<BankQuestion | "new" | null>(null);
  const [title, setTitle] = useState(pack.title);
  const [defaultTime, setDefaultTime] = useState(pack.default_time_limit_sec);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const id = encodeURIComponent(pack.quiz_pack_id);

  const load = useCallback(async () => {
    try {
      const r = await api<{ questions: BankQuestion[] }>(`/api/admin/packs/${id}`);
      setQuestions(r.questions);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(label);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg(done);
      await load();
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  function moveTo(from: number, to: number) {
    if (!questions || from === to) return;
    const next = arrayMove(questions, from, to);
    setQuestions(next);
    void run("order", () => api(`/api/admin/packs/${id}/order`, { method: "POST", json: { question_ids: next.map((q) => q.question_id) } }));
  }

  function duplicate(q: BankQuestion) {
    const copy: BankQuestion = { ...q, question_id: `${pack.quiz_pack_id.slice(0, 40)}-${Math.random().toString(36).slice(2, 10)}`, question_text: `${q.question_text} (copy)` };
    void run("dup", () => api(`/api/admin/questions/${encodeURIComponent(copy.question_id)}`, { method: "PUT", json: { question: copy } }), "Question duplicated. It's at the end of the list.");
  }

  const qSort = useSortable(questions?.length ?? 0, moveTo);

  const totalSec = (questions ?? []).reduce((s, q) => s + (q.time_limit_sec ?? pack.default_time_limit_sec), 0);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-48 flex-1">
            <span className="mb-1 block text-xs text-muted">Pack name</span>
            <input className={inputCls("h-10 font-semibold")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Default time per question</span>
            <select className={inputCls("h-10 w-32")} value={defaultTime} onChange={(e) => setDefaultTime(Number(e.target.value))}>
              {[...new Set([...TIME_PRESETS, defaultTime])].sort((a, b) => a - b).map((t) => <option key={t} value={t}>{t} seconds</option>)}
            </select>
          </label>
          <Button
            size="sm"
            variant="secondary"
            className="h-10"
            loading={busy === "save"}
            disabled={title.trim() === pack.title && defaultTime === pack.default_time_limit_sec}
            onClick={() => run("save", () => api(`/api/admin/packs/${id}`, { method: "PATCH", json: { title, default_time_limit_sec: defaultTime } }), "Pack saved.")}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-10"
            loading={busy === "all"}
            onClick={() => run("all", () => api(`/api/admin/packs/${id}`, { method: "PATCH", json: { apply_time_to_all: defaultTime } }), `Every question now has ${defaultTime} seconds.`)}
          >
            Use {defaultTime}s for every question
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted tabular">
          {questions?.length ?? 0} questions · about {Math.round(totalSec / 60)} min of answering time. Questions without their own time use the default. Drag ⠿ to reorder questions.
        </p>
        {msg ? <p className="mt-2 text-sm text-good">✔ {msg}</p> : null}
        {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
      </Card>

      {editing ? (
        <Card className="border-gold/50 p-5">
          <h3 className="mb-4 font-headline text-xl font-bold">{editing === "new" ? "New question" : "Edit question"}</h3>
          <QuestionEditor
            packId={pack.quiz_pack_id}
            packDefaultTime={pack.default_time_limit_sec}
            initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setMsg(editing === "new" ? "Question added." : "Question saved.");
              void load();
              onChanged();
            }}
          />
        </Card>
      ) : (
        <Button onClick={() => setEditing("new")} className="w-full" size="lg">+ Add a question</Button>
      )}

      <Card className="p-2">
        {!questions ? (
          <Spinner className="m-4" />
        ) : questions.length === 0 ? (
          <p className="p-6 text-center text-muted">No questions yet. Press “Add a question”.</p>
        ) : (
          <ol ref={qSort.listRef} className="divide-y divide-line">
            {qSort.order.map((idx, i) => {
              const q = questions[idx];
              return (
              <li
                key={q.question_id}
                data-sortable-item={idx}
                className={cx("flex items-start gap-3 bg-panel p-3 transition", qSort.dragging === idx && "relative z-10 rounded-xl opacity-80 ring-2 ring-gold")}
              >
                <span
                  {...qSort.handleProps(idx)}
                  className="grid h-10 w-6 shrink-0 select-none place-items-center rounded text-xl text-muted hover:bg-white/5 hover:text-white"
                >
                  {GRIP}
                </span>
                <span className="w-6 pt-1 text-right text-sm text-muted tabular">{i + 1}</span>
                {q.media_url ? (
                  <span className="shrink-0">
                    {q.media_type === "image" || !q.media_type ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={q.media_url} alt="" className="h-14 w-20 rounded-md bg-ink object-cover" />
                    ) : (
                      <span className="grid h-14 w-20 place-items-center rounded-md bg-panel-2 text-2xl">{q.media_type === "audio" ? "🎵" : "🎬"}</span>
                    )}
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug">{q.question_text}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded bg-white/10 px-1.5 py-0.5">{TYPE_LABEL[q.type]}</span>
                    <span className={cx("rounded px-1.5 py-0.5 tabular", q.time_limit_sec ? "bg-gold/15 text-gold" : "bg-white/5 text-muted")}>
                      ⏱ {q.time_limit_sec ?? pack.default_time_limit_sec}s
                    </span>
                    {q.base_points && q.base_points !== 100 ? <span className="rounded bg-white/5 px-1.5 py-0.5 text-muted">{q.base_points} pts</span> : null}
                    {q.choices ? (
                      q.choices.map((c) => (
                        <span key={c.choice_id} style={choiceTileStyle(c.choice_id, 0.3)} className={cx("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-white", !q.correct_answers_array.includes(c.choice_id) && "opacity-40")}>
                          <b>{c.choice_id}</b> {c.text || (c.media_url ? "🖼" : "")}
                        </span>
                      ))
                    ) : q.sub_questions ? (
                      <span className="text-good">
                        {q.sub_questions.length} parts: {q.sub_questions.map((sq, j) => `${j + 1}. ${sq.prompt} → ${sq.correct_answers_array[0]}`).join("  ")}
                      </span>
                    ) : (
                      <span className="text-good">✔ {q.correct_answers_array.join(" · ")}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(q)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => duplicate(q)} disabled={!!busy}>Copy</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hover:text-bad"
                    onClick={() => run("del", () => api(`/api/admin/questions/${encodeURIComponent(q.question_id)}`, { method: "DELETE" }), "Question deleted.")}
                  >
                    Delete
                  </Button>
                </div>
              </li>
              );
            })}
          </ol>
        )}
      </Card>

      <div className="flex justify-end">
        {confirmDelete ? (
          <span className="flex items-center gap-2 text-sm">
            Delete “{pack.title}” and all {pack.question_count} questions?
            <Button size="sm" variant="danger" onClick={() => run("delpack", () => api(`/api/admin/packs/${id}`, { method: "DELETE" }))}>Yes, delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" className="hover:text-bad" onClick={() => setConfirmDelete(true)}>Delete this pack</Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spreadsheet import (optional route)
// ---------------------------------------------------------------------------

interface Parsed {
  fileName: string;
  doc: ImportDoc;
  rowOf: number[] | null;
  rowProblems: { row: number; message: string }[];
}

interface ImportResponse {
  ok: boolean;
  issues: ImportIssue[];
  summary?: { packs: string[]; new_packs: string[]; question_count: number };
  result?: { packs: number; questions: number };
}

async function parseFile(file: File): Promise<Parsed> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    return { fileName: file.name, doc: normalizeJsonImport(JSON.parse(await file.text())), rowOf: null, rowProblems: [] };
  }
  const XLSX = await import("xlsx");
  const wb = name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
  const { doc, rowOf, problems } = rowsToImport(rows);
  return { fileName: file.name, doc, rowOf, rowProblems: problems };
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [check, setCheck] = useState<ImportResponse | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("append");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setDone(null);
    setCheck(null);
    setParsed(null);
    setBusy("parse");
    try {
      const p = await parseFile(file);
      setParsed(p);
      setCheck(await api<ImportResponse>("/api/admin/bank/import", { method: "POST", json: { doc: p.doc, mode, dryRun: true } }));
    } catch (e) {
      setError(e instanceof SyntaxError ? "That JSON file couldn't be read." : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doImport() {
    if (!parsed) return;
    setBusy("import");
    try {
      const res = await api<ImportResponse>("/api/admin/bank/import", { method: "POST", json: { doc: parsed.doc, mode, dryRun: false } });
      if (!res.ok) setCheck(res);
      else {
        setDone(`Imported ${res.result?.questions ?? 0} questions.`);
        setParsed(null);
        setCheck(null);
        onImported();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const rowLabel = (qi: number | null) => (qi === null ? "File" : parsed?.rowOf ? `Row ${parsed.rowOf[qi]}` : `Question ${qi + 1}`);
  const blocking = (parsed?.rowProblems.length ?? 0) > 0 || (check ? !check.ok : true);

  return (
    <div className="mt-3 space-y-3 text-sm">
      <p className="text-muted">
        Get the <a className="text-gold underline" href="/question-template.csv" download>template</a> or the{" "}
        <a className="text-gold underline" href="/sample-pack.csv" download>12-question sample pack</a>. Columns include time_limit_sec for each question.
      </p>
      <label className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-line p-5 text-center hover:border-gold">
        <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.json" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        {busy === "parse" ? <Spinner /> : <span className="font-semibold">Choose a file</span>}
        <span className="text-xs text-muted">Checked before anything is saved</span>
      </label>
      <div className="space-y-1">
        <label className="flex items-start gap-2"><input type="radio" checked={mode === "append"} onChange={() => setMode("append")} className="mt-1" /> Add to the pack</label>
        <label className="flex items-start gap-2"><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} className="mt-1" /> Replace the pack&apos;s questions</label>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {done ? <p className="text-good">✔ {done}</p> : null}
      {parsed ? (
        <div className="space-y-2">
          <p><b>{parsed.fileName}</b>: {parsed.doc.questions.length} questions</p>
          {parsed.rowProblems.length || (check && check.issues.length) ? (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-bad/40 bg-bad/5 p-2">
              {parsed.rowProblems.map((p, i) => <li key={`r${i}`}><b>Row {p.row}:</b> {p.message}</li>)}
              {check?.issues.map((p, i) => <li key={`i${i}`}><b>{rowLabel(p.question_index)}:</b> {p.message}</li>)}
            </ul>
          ) : check?.ok ? <p className="text-good">✔ Everything checks out.</p> : null}
          <Button className="w-full" size="sm" disabled={blocking} loading={busy === "import"} onClick={doImport}>Import {parsed.doc.questions.length} questions</Button>
        </div>
      ) : null}
    </div>
  );
}

