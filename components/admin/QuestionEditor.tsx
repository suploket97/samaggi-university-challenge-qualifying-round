"use client";
import { useRef, useState } from "react";
import { CHOICE_LETTERS, MAX_CHOICES, MAX_SUB_QUESTIONS, type BankQuestion, type ChoiceId, type QuestionType } from "@/lib/game/types";
import { api, ApiError } from "@/lib/client/api";
import { GRIP, arrayMove, useSortable } from "@/lib/client/useSortable";
import { kindOf, uploadMedia, type MediaKind } from "@/lib/client/upload";
import { Button, ErrorNote, Spinner, cx, inputClass, inputCls } from "@/components/ui";
import { choiceColor } from "@/components/game";

const LETTERS: ChoiceId[] = CHOICE_LETTERS;
export const TIME_PRESETS = [10, 15, 20, 30, 45, 60, 90, 120];

interface PartDraft {
  key: string;
  prompt: string;
  /** Accepted answers separated by "|". */
  answers: string;
  points: number | null;
}

export const MAX_QUESTION_TEXT = 3000;

/** Rows for a textarea so its content shows without scrolling (roughly `perLine` characters per row). */
function autoRows(value: string, min: number, max: number, perLine = 90): number {
  const lines = value.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return Math.max(min, Math.min(max, lines));
}

/** Mirrors subQuestionPoints: blank parts share the question's points evenly. */
function partPoints(parts: PartDraft[], base: number): number[] {
  const n = parts.length || 1;
  const even = Math.floor(base / n);
  const extra = base - even * n;
  return parts.map((p, i) => (p.points !== null ? p.points : even + (i < extra ? 1 : 0)));
}

interface ChoiceDraft {
  key: string;
  text: string;
  media_url: string | null;
  correct: boolean;
}

const newKey = () => Math.random().toString(36).slice(2, 10);

function newQuestionId(packId: string) {
  return `${packId.slice(0, 40)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Create or edit one question. All fields map 1:1 onto the question bank schema. */
export function QuestionEditor({
  packId,
  packDefaultTime,
  initial,
  onSaved,
  onCancel,
}: {
  packId: string;
  packDefaultTime: number;
  initial: BankQuestion | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? "MCQ_SINGLE");
  const [text, setText] = useState(initial?.question_text ?? "");
  const [media, setMedia] = useState<{ url: string; kind: MediaKind } | null>(
    initial?.media_url ? { url: initial.media_url, kind: (initial.media_type as MediaKind) ?? "image" } : null,
  );
  const [showOnPhones, setShowOnPhones] = useState<boolean>(
    initial?.show_media_on_player ?? (initial?.media_type ? initial.media_type === "image" : true),
  );
  const [choices, setChoices] = useState<ChoiceDraft[]>(() =>
    initial?.choices?.length
      ? initial.choices.map((c) => ({
          key: newKey(),
          text: c.text,
          media_url: c.media_url ?? null,
          correct: initial.correct_answers_array.includes(c.choice_id),
        }))
      : [0, 1, 2, 3].map((i) => ({ key: newKey(), text: "", media_url: null, correct: i === 0 })),
  );
  const [answers, setAnswers] = useState<string[]>(
    initial?.type === "TEXT_INPUT" ? [...initial.correct_answers_array, ""] : ["", ""],
  );
  const [parts, setParts] = useState<PartDraft[]>(() =>
    initial?.sub_questions?.length
      ? initial.sub_questions.map((sq) => ({ key: newKey(), prompt: sq.prompt, answers: sq.correct_answers_array.join(" | "), points: sq.points ?? null }))
      : [0, 1, 2].map(() => ({ key: newKey(), prompt: "", answers: "", points: null })),
  );
  const [fuzzy, setFuzzy] = useState(initial?.text_matching?.fuzzy ?? true);
  const [time, setTime] = useState<number | null>(initial?.time_limit_sec ?? null);
  const [points, setPoints] = useState<number>(initial?.base_points ?? 100);
  const [multiScoring, setMultiScoring] = useState(initial?.multi_scoring ?? "PARTIAL");
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Drag-to-reorder for choices and parts (letters and part numbers follow the new order).
  const choiceSort = useSortable(choices.length, (from, to) => setChoices((cs) => arrayMove(cs, from, to)));
  const partSort = useSortable(parts.length, (from, to) => setParts((ps) => arrayMove(ps, from, to)));

  const isMcq = type === "MCQ_SINGLE" || type === "MCQ_MULTI";
  const isSub = type === "SUB_QUESTIONS_TEXT";

  function switchType(t: QuestionType) {
    setType(t);
    if (t === "MCQ_SINGLE") {
      // keep only the first correct choice
      let seen = false;
      setChoices((cs) => cs.map((c) => ({ ...c, correct: c.correct && !seen ? (seen = true) : false })));
    }
  }

  async function upload(file: File, target: "question" | string) {
    setErrors([]);
    setUploading(target);
    try {
      const res = await uploadMedia(file);
      if (target === "question") {
        setMedia(res);
        setShowOnPhones(res.kind === "image");
      } else {
        if (res.kind !== "image") throw new Error("Choices can only have pictures.");
        setChoices((cs) => cs.map((c) => (c.key === target ? { ...c, media_url: res.url } : c)));
      }
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setUploading(null);
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const files: File[] = e.clipboardData ? Array.from(e.clipboardData.files) : [];
    const file = files.find((f) => kindOf(f.type) === "image");
    if (file) {
      e.preventDefault();
      void upload(file, "question");
    }
  }

  function build(): { q: BankQuestion | null; problems: string[] } {
    const problems: string[] = [];
    const qtext = text.trim();
    if (!qtext) problems.push("Write the question.");
    const q: BankQuestion = {
      question_id: initial?.question_id ?? newQuestionId(packId),
      quiz_pack_id: packId,
      type,
      question_text: qtext,
      correct_answers_array: [],
    };
    if (media) {
      q.media_url = media.url;
      q.media_type = media.kind;
      q.show_media_on_player = showOnPhones;
    }
    if (isMcq) {
      const filled = choices.filter((c) => c.text.trim() || c.media_url);
      if (filled.length < 2) problems.push("Add at least two choices.");
      q.choices = filled.map((c, i) => ({
        choice_id: LETTERS[i],
        text: c.text.trim(),
        ...(c.media_url ? { media_url: c.media_url } : {}),
      }));
      q.correct_answers_array = filled.flatMap((c, i) => (c.correct ? [LETTERS[i]] : []));
      if (q.correct_answers_array.length === 0) problems.push("Mark the correct choice.");
      if (type === "MCQ_SINGLE" && q.correct_answers_array.length > 1) problems.push("Only one choice can be correct. Switch to “Several answers” to allow more.");
      if (type === "MCQ_MULTI") q.multi_scoring = multiScoring;
    } else if (isSub) {
      const filled = parts.filter((p) => p.prompt.trim() || p.answers.trim());
      if (filled.length === 0) problems.push("Add at least one part.");
      q.correct_answers_array = [];
      q.sub_questions = filled.map((p, i) => {
        const acc = [...new Set(p.answers.split("|").map((a) => a.trim()).filter(Boolean))];
        if (!p.prompt.trim()) problems.push(`Part ${i + 1} needs a question.`);
        if (acc.length === 0) problems.push(`Part ${i + 1} needs at least one accepted answer.`);
        return { sub_id: String(i + 1), prompt: p.prompt.trim(), correct_answers_array: acc, ...(p.points !== null ? { points: p.points } : {}) };
      });
      q.text_matching = { fuzzy, max_typos: 2 };
    } else {
      const acc = [...new Set(answers.map((a) => a.trim()).filter(Boolean))];
      if (acc.length === 0) problems.push("Write the correct answer.");
      q.correct_answers_array = acc;
      q.text_matching = { fuzzy, max_typos: 2 };
    }
    if (time !== null) q.time_limit_sec = time;
    if (points !== 100) q.base_points = points;
    if (explanation.trim()) q.explanation = explanation.trim();
    return { q: problems.length ? null : q, problems };
  }

  async function save() {
    const { q, problems } = build();
    setErrors(problems);
    if (!q) return;
    setSaving(true);
    try {
      const res = await api<{ ok: boolean; issues?: string[] }>(`/api/admin/questions/${encodeURIComponent(q.question_id)}`, {
        method: "PUT",
        json: { question: q },
      });
      if (!res.ok) setErrors(res.issues ?? ["Couldn't save"]);
      else onSaved();
    } catch (e) {
      const body = (e as ApiError).body as { issues?: string[] } | undefined;
      setErrors(body?.issues ?? [(e as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  const effectiveTime = time ?? packDefaultTime;

  return (
    <div className="space-y-5" onPaste={onPaste}>
      {/* Type */}
      <div>
        <p className="mb-2 text-sm text-muted">Answer type</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["MCQ_SINGLE", "One answer", "Tap a choice"],
              ["MCQ_MULTI", "Several answers", "Pick all that apply"],
              ["TEXT_INPUT", "Typed answer", "Players type it"],
              ["SUB_QUESTIONS_TEXT", "Sub-questions", "Several typed parts, points add up"],
            ] as [QuestionType, string, string][]
          ).map(([t, label, sub]) => (
            <button
              key={t}
              type="button"
              onClick={() => switchType(t)}
              className={cx(
                "rounded-xl border p-3 text-left transition",
                type === t ? "border-gold bg-gold/10" : "border-line hover:border-muted",
              )}
            >
              <span className="block font-semibold">{label}</span>
              <span className="text-xs text-muted">{sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Question */}
      <label className="block">
        <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm text-muted">
          <span>Question{isSub ? " (or a passage the parts are about)" : ""}</span>
          <span className={cx("text-xs tabular", text.length > MAX_QUESTION_TEXT * 0.9 && "text-gold")}>
            {text.length} / {MAX_QUESTION_TEXT}
          </span>
        </span>
        <textarea
          className={inputCls("h-auto min-h-20 resize-y py-3 leading-snug")}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_QUESTION_TEXT))}
          placeholder={media?.kind === "image" ? "e.g. Which country's flag is this?" : "e.g. What is the capital of Australia?"}
          rows={autoRows(text, 2, 12)}
        />
        {text.length > 250 ? (
          <span className="mt-1 block text-xs text-muted">Long text is shrunk automatically to fit the big screen. Press Enter for a new paragraph.</span>
        ) : null}
      </label>

      {/* Media */}
      <div>
        <span className="mb-1.5 block text-sm text-muted">Picture, sound or video (optional)</span>
        {media ? (
          <div className="flex flex-wrap items-start gap-4 rounded-xl border border-line p-3">
            <MediaPreview url={media.url} kind={media.kind} className="max-h-48 max-w-full rounded-lg sm:max-w-sm" />
            <div className="space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showOnPhones} onChange={(e) => setShowOnPhones(e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
                Also show on players&apos; phones
              </label>
              <p className="max-w-xs text-xs text-muted">
                {media.kind === "image"
                  ? "Recommended for pictures, so teams at the back can see the detail."
                  : "Sound and video usually play only on the big screen."}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" type="button" onClick={() => fileRef.current?.click()}>Replace</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setMedia(null)}>Remove</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-line p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} loading={uploading === "question"}>
                Upload a file
              </Button>
              <span className="text-sm text-muted">or paste a picture here, or use a link:</span>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className={inputCls("h-10")}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://…/picture.jpg"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-10"
                disabled={!/^https?:\/\/\S+$/i.test(urlInput.trim())}
                onClick={() => {
                  const u = urlInput.trim();
                  const k: MediaKind = /\.(mp3|wav|ogg|m4a|aac)(\?|$)/i.test(u) ? "audio" : /\.(mp4|webm|mov)(\?|$)/i.test(u) ? "video" : "image";
                  setMedia({ url: u, kind: k });
                  setShowOnPhones(k === "image");
                  setUrlInput("");
                }}
              >
                Use link
              </Button>
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,audio/*,video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f, "question");
            e.target.value = "";
          }}
        />
      </div>

      {/* Choices / answers */}
      {isMcq ? (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm text-muted">Choices — tick the {type === "MCQ_SINGLE" ? "correct one" : "correct ones"}. Drag ⠿ to reorder.</span>
            <span className="text-xs text-muted">Up to 26 choices (A–Z). Each can be text, a picture, or both.</span>
          </div>
          <ol ref={choiceSort.listRef} className="space-y-2">
            {choiceSort.order.map((idx, i) => {
              const c = choices[idx];
              return (
              <li key={c.key} data-sortable-item={idx} className={cx("rounded-xl transition", choiceSort.dragging === idx && "opacity-70 ring-2 ring-gold")}>
              <ChoiceRow
                letter={LETTERS[i]}
                handle={choiceSort.handleProps(idx)}
                choice={c}
                single={type === "MCQ_SINGLE"}
                uploading={uploading === c.key}
                canRemove={choices.length > 2}
                onChange={(patch) =>
                  setChoices((cs) =>
                    cs.map((x) => {
                      if (x.key !== c.key) return type === "MCQ_SINGLE" && patch.correct ? { ...x, correct: false } : x;
                      return { ...x, ...patch };
                    }),
                  )
                }
                onUpload={(f) => void upload(f, c.key)}
                onRemove={() => setChoices((cs) => cs.filter((x) => x.key !== c.key))}
              />
              </li>
              );
            })}
          </ol>
          {choices.length < MAX_CHOICES ? (
            <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setChoices((cs) => [...cs, { key: newKey(), text: "", media_url: null, correct: false }])}>
              + Add choice
            </Button>
          ) : null}
          {type === "MCQ_MULTI" ? (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-muted">Scoring:</span>
              <select className={inputCls("h-9 w-auto")} value={multiScoring} onChange={(e) => setMultiScoring(e.target.value as "PARTIAL" | "ALL_OR_NOTHING")}>
                <option value="PARTIAL">Part marks for each correct pick</option>
                <option value="ALL_OR_NOTHING">Points only if all picks are right</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : isSub ? (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-muted">Parts: each gets its own answer box on the phone and is marked on its own. Drag ⠿ to reorder.</span>
            <span className="text-xs text-muted tabular">
              Total {partPoints(parts, points).reduce((a, b) => a + b, 0)} pts
            </span>
          </div>
          <ol ref={partSort.listRef} className="space-y-2">
            {partSort.order.map((idx, i) => {
              const p = parts[idx];
              return (
              <li key={p.key} data-sortable-item={idx} className={cx("rounded-xl border border-line p-3 transition", partSort.dragging === idx && "opacity-70 ring-2 ring-gold")}>
                {/* Line 1: the part's question gets the full width. */}
                <div className="flex items-start gap-2">
                  <span {...partSort.handleProps(idx)} className="grid h-10 w-6 shrink-0 select-none place-items-center rounded text-lg text-muted hover:text-white">{GRIP}</span>
                  <span className="w-6 shrink-0 pt-2 font-display font-bold text-gold tabular">{i + 1}.</span>
                  <textarea
                    className={inputCls("block h-auto min-h-11 w-full min-w-0 flex-1 resize-y py-2.5 leading-snug")}
                    value={p.prompt}
                    maxLength={500}
                    rows={autoRows(p.prompt, 2, 8, 70)}
                    onChange={(e) => setParts((ps) => ps.map((x) => (x.key === p.key ? { ...x, prompt: e.target.value } : x)))}
                    placeholder={i === 0 ? "Part 1 question, e.g. What is the capital of Australia?" : `Part ${i + 1} question`}
                    aria-label={`Part ${i + 1} question`}
                  />
                </div>
                {/* Line 2: accepted answers, then the small points box and Remove. */}
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-14">
                  <input
                    className={inputCls("h-10 min-w-48 flex-1")}
                    style={{ borderColor: "rgb(16 185 129 / 0.5)" }}
                    value={p.answers}
                    maxLength={600}
                    onChange={(e) => setParts((ps) => ps.map((x) => (x.key === p.key ? { ...x, answers: e.target.value } : x)))}
                    placeholder="Accepted answers, separated by |  e.g. Canberra"
                    aria-label={`Part ${i + 1} accepted answers`}
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      className={inputCls("h-10 w-16 px-2 text-center text-sm")}
                      value={p.points ?? ""}
                      placeholder={String(partPoints(parts, points)[i])}
                      onChange={(e) =>
                        setParts((ps) =>
                          ps.map((x) =>
                            x.key === p.key ? { ...x, points: e.target.value === "" ? null : Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))) } : x,
                          ),
                        )
                      }
                      aria-label={`Part ${i + 1} points`}
                      title="Points for this part. Leave blank to split the question's points evenly."
                    />
                    pts
                  </label>
                  <RemoveButton
                    disabled={parts.length <= 1}
                    label={`Remove part ${i + 1}`}
                    disabledReason="A sub-question needs at least one part"
                    onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))}
                  />
                </div>
              </li>
              );
            })}
          </ol>
          {parts.length < MAX_SUB_QUESTIONS ? (
            <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setParts((ps) => [...ps, { key: newKey(), prompt: "", answers: "", points: null }])}>
              + Add part
            </Button>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            The question&apos;s score is the sum of the parts answered correctly. Blank points split the question&apos;s {points} points evenly. The speed bonus only applies when every part is right.
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fuzzy} onChange={(e) => setFuzzy(e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
            Forgive small typos in every part
          </label>
        </div>
      ) : (
        <div>
          <span className="mb-1.5 block text-sm text-muted">Correct answer</span>
          <div className="space-y-2">
            {answers.map((a, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={inputCls("h-11")}
                  style={i === 0 ? { borderColor: "rgb(16 185 129 / 0.6)" } : undefined}
                  value={a}
                  onChange={(e) => {
                    const v = e.target.value.slice(0, 200);
                    setAnswers((as) => {
                      const next = as.map((x, j) => (j === i ? v : x));
                      // always keep one empty box at the end for another alternative
                      if (next[next.length - 1].trim()) next.push("");
                      return next;
                    });
                  }}
                  placeholder={i === 0 ? "Answer shown on the big screen, e.g. Leonardo da Vinci" : "Also accept… e.g. da Vinci"}
                />
                {i > 0 && a ? (
                  <Button type="button" size="sm" variant="ghost" className="h-11" onClick={() => setAnswers((as) => as.filter((_, j) => j !== i))}>✕</Button>
                ) : null}
              </div>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fuzzy} onChange={(e) => setFuzzy(e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
            Forgive small typos (1 for 5–8 letters, 2 for longer; numbers and short words must be exact)
          </label>
          <p className="mt-1 text-xs text-muted">Capitals, accents, punctuation and “the/a/an” at the start are always ignored.</p>
        </div>
      )}

      {/* Time + points */}
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <span className="mb-1.5 block text-sm text-muted">Time to answer</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTime(null)}
              className={cx("h-9 rounded-lg border px-3 text-sm", time === null ? "border-gold bg-gold/15 text-gold" : "border-line text-muted hover:text-white")}
            >
              Pack default ({packDefaultTime}s)
            </button>
            {TIME_PRESETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTime(t)}
                className={cx("h-9 min-w-12 rounded-lg border px-3 text-sm tabular", time === t ? "border-gold bg-gold/15 text-gold" : "border-line text-muted hover:text-white")}
              >
                {t}s
              </button>
            ))}
            <input
              type="number"
              min={5}
              max={600}
              aria-label="Custom seconds"
              className={inputCls("h-9 w-24")}
              value={time !== null && !TIME_PRESETS.includes(time) ? time : ""}
              placeholder="Other"
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                setTime(e.target.value === "" ? null : Math.max(5, Math.min(600, n || 5)));
              }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">This question: {effectiveTime} seconds. You can still add time during the game.</p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">Points</span>
          <input type="number" min={0} max={1000} className={inputCls("h-9 w-28")} value={points} onChange={(e) => setPoints(Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))))} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm text-muted">Fun fact shown after the reveal (optional)</span>
        <input className={inputClass} value={explanation} onChange={(e) => setExplanation(e.target.value.slice(0, 500))} placeholder="e.g. Canberra was built as a compromise between Sydney and Melbourne." />
      </label>

      {errors.length ? (
        <ErrorNote>
          {errors.map((e, i) => (
            <span key={i} className="block">{e}</span>
          ))}
        </ErrorNote>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" onClick={save} loading={saving} disabled={!!uploading}>
          {initial ? "Save changes" : "Add question"}
        </Button>
      </div>
    </div>
  );
}

function ChoiceRow({
  letter,
  handle,
  choice,
  single,
  uploading,
  canRemove,
  onChange,
  onUpload,
  onRemove,
}: {
  letter: ChoiceId;
  handle: ReturnType<ReturnType<typeof useSortable>["handleProps"]>;
  choice: ChoiceDraft;
  single: boolean;
  uploading: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<ChoiceDraft>) => void;
  onUpload: (f: File) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={cx("flex items-center gap-2 rounded-xl border p-2", choice.correct ? "border-good/70 bg-good/5" : "border-line")}>
      <span {...handle} className="grid h-9 w-5 shrink-0 select-none place-items-center rounded text-lg text-muted hover:text-white">{GRIP}</span>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg font-display font-bold text-ink" style={{ backgroundColor: choiceColor(letter) }}>{letter}</span>
      {choice.media_url ? (
        <span className="relative shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={choice.media_url} alt="" className="h-11 w-16 rounded-md object-cover" />
          <button type="button" className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-xs" onClick={() => onChange({ media_url: null })} aria-label="Remove picture">✕</button>
        </span>
      ) : null}
      <input
        className={inputCls("h-10 min-w-0 flex-1")}
        value={choice.text}
        onChange={(e) => onChange({ text: e.target.value.slice(0, 200) })}
        placeholder={choice.media_url ? "Caption (optional)" : `Choice ${letter}`}
      />
      <button type="button" className="shrink-0 rounded-lg px-2 py-2 text-sm text-muted hover:bg-white/5 hover:text-white" onClick={() => ref.current?.click()} title="Add a picture to this choice">
        {uploading ? <Spinner className="h-4 w-4" /> : "🖼"}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-sm hover:bg-white/5">
        <input
          type={single ? "radio" : "checkbox"}
          checked={choice.correct}
          onChange={(e) => onChange({ correct: e.target.checked })}
          className="h-4 w-4 accent-[var(--color-good)]"
        />
        <span className={choice.correct ? "text-good" : "text-muted"}>Correct</span>
      </label>
      <RemoveButton disabled={!canRemove} label={`Remove choice ${letter}`} disabledReason="A question needs at least 2 choices" onClick={onRemove} />
    </div>
  );
}

/** Always-visible Remove button; greyed out (with the reason) at the minimum count. */
function RemoveButton({ disabled, label, disabledReason, onClick }: { disabled: boolean; label: string; disabledReason: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={disabled ? disabledReason : label}
      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 text-sm text-muted transition hover:border-bad/60 hover:text-bad disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line disabled:hover:text-muted"
    >
      <span aria-hidden>🗑</span>
      <span className="hidden sm:inline">Remove</span>
    </button>
  );
}

export function MediaPreview({ url, kind, className }: { url: string; kind: MediaKind | string | null | undefined; className?: string }) {
  if (kind === "audio") return <audio src={url} controls className={cx("w-72", className)} />;
  if (kind === "video") return <video src={url} controls playsInline className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={cx("object-contain", className)} />;
}
