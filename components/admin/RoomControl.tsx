"use client";
import { useEffect, useState } from "react";
import type { PublicSnapshot } from "@/lib/game/engine";
import type { AntiCheatFlag, AdminCommand, RoomSettings } from "@/lib/game/types";
import { adminView } from "@/lib/game/projections";
import { api, ApiError } from "@/lib/client/api";
import { useAutoTick, useNow, usePoll, useRoom } from "@/lib/client/hooks";
import { Button, Card, ConnectionDot, ErrorNote, Spinner, cx, inputCls } from "@/components/ui";
import { ChoiceBadge, Countdown, choiceTileStyle } from "@/components/game";
import { QrCode } from "@/components/QrCode";
import { AdminShell } from "./AdminShell";
import { PhaseBadge } from "./AdminHome";

interface AdminStatus {
  snapshot: PublicSnapshot;
  settings: RoomSettings;
  current_answer: {
    correct_answers_array: string[];
    type: string;
    explanation: string | null;
    sub_questions: { sub_id: string; prompt: string; correct_answers_array: string[]; points?: number }[] | null;
  } | null;
  next_question: { index: number; question_text: string; type: string; time_limit_sec: number; media_url: string | null } | null;
  teams: {
    team_id: string;
    name: string;
    score: number;
    rank: number | null;
    answered: boolean;
    answer: string[] | null;
    flags: AntiCheatFlag[];
    frozen_now: boolean;
  }[];
  answered_count: number;
}

interface PackItem {
  quiz_pack_id: string;
  title: string;
  question_count: number;
}

export function RoomControl({ code }: { code: string }) {
  const room = useRoom(code);
  useAutoTick(code, room, 100);
  const now = useNow(200);
  const { data: status, reload } = usePoll<AdminStatus>(`/api/admin/rooms/${code}/status`, 1500);
  const [packs, setPacks] = useState<PackItem[] | null>(null);
  const [packId, setPackId] = useState("");
  const [qualifyCount, setQualifyCount] = useState(8);
  const [timeOverride, setTimeOverride] = useState<number | null>(null);
  const [packAction, setPackAction] = useState<"idle" | "confirm" | "deleting" | "deleted" | "kept">("idle");
  const nextIndex = status?.next_question?.index ?? -1;
  useEffect(() => setTimeOverride(null), [nextIndex]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    api<{ packs: PackItem[] }>("/api/admin/packs")
      .then((r) => {
        setPacks(r.packs);
        if (r.packs[0]) setPackId((p) => p || r.packs[0].quiz_pack_id);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  // Prefer whichever snapshot is newer: realtime or the admin poll.
  const snap =
    room.snapshot && status?.snapshot
      ? room.snapshot.version >= status.snapshot.version
        ? room.snapshot
        : status.snapshot
      : room.snapshot ?? status?.snapshot ?? null;

  async function send(cmd: AdminCommand, label: string) {
    setBusy(label);
    setError(null);
    try {
      await api(`/api/admin/rooms/${code}/command`, { method: "POST", json: cmd });
      await room.refresh();
      reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  if (room.notFound) {
    return (
      <AdminShell title={`Room ${code}`}>
        <p className="text-muted">This room doesn&apos;t exist or has expired.</p>
      </AdminShell>
    );
  }
  if (!snap) {
    return (
      <AdminShell title={`Room ${code}`}>
        <Spinner />
      </AdminShell>
    );
  }

  const av = adminView(snap, now + room.offset);
  const q = snap.current_question;
  const isLast = snap.total_questions > 0 && snap.current_question_index + 1 >= snap.total_questions;
  const teamCount = status?.teams.length ?? snap.leaderboard.length;
  const joinUrl = `${origin}/play?code=${code}`;
  // Only trust the answer if the status poll is about the question currently on screen.
  const statusSameQ = status?.snapshot.current_question?.question_id === snap.current_question?.question_id;
  const correct = new Set(statusSameQ ? status?.current_answer?.correct_answers_array ?? [] : []);

  return (
    <AdminShell
      title={
        <span className="flex items-center gap-3">
          Room <span className="tracking-widest text-gold">{code}</span> <PhaseBadge phase={snap.phase} />
          <ConnectionDot connected={room.connected} />
        </span>
      }
      actions={
        <>
          <a href={`/stage/${code}`} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm">Open stage ↗</Button>
          </a>
          <Button
            variant="danger"
            size="sm"
            disabled={!av.buttons.terminate}
            onClick={() => confirm("End the game for everyone?") && send({ type: "TERMINATE" }, "end")}
          >
            End game
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {/* ---------------- Controls ---------------- */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-6">
              {snap.phase === "PLAYING" && q ? (
                <Countdown remainingMs={av.remaining_ms} totalSec={q.time_limit_sec} size={96} />
              ) : null}
              <div className="flex-1">
                <p className="text-sm text-muted">{av.question_label ?? (snap.quiz_pack_id ? `Pack loaded: ${snap.total_questions} questions` : "No pack loaded")}</p>
                <p className="font-headline text-2xl font-bold">{phaseHeadline(snap.phase)}</p>
                <p className="text-muted tabular">
                  {teamCount} teams
                  {snap.phase === "PLAYING" || snap.phase === "SUBMITTED_WAITING" ? ` · ${status?.answered_count ?? 0} answered` : ""}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-3">
              {snap.phase === "WAITING" ? (
                <>
                  <select className={inputCls("w-auto min-w-64")} value={packId} onChange={(e) => setPackId(e.target.value)}>
                    {!packs ? <option>Loading packs…</option> : null}
                    {packs && packs.length === 0 ? <option value="">No packs — import one in Question bank</option> : null}
                    {packs?.map((p) => (
                      <option key={p.quiz_pack_id} value={p.quiz_pack_id}>
                        {p.title} ({p.question_count})
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" disabled={!packId} loading={busy === "pack"} onClick={() => send({ type: "SELECT_PACK", quiz_pack_id: packId }, "pack")}>
                    {snap.quiz_pack_id ? "Switch pack" : "Load pack"}
                  </Button>
                </>
              ) : null}

              {av.buttons.startQuestion ? (
                <Button
                  size="lg"
                  loading={busy === "start"}
                  onClick={() => send(timeOverride ? { type: "START_QUESTION", time_limit_sec: timeOverride } : { type: "START_QUESTION" }, "start")}
                >
                  {snap.current_question_index < 0 ? "▶ Start question 1" : `▶ Next question (${snap.current_question_index + 2})`}
                  {status?.next_question ? <span className="font-normal opacity-70">· {timeOverride ?? status.next_question.time_limit_sec}s</span> : null}
                </Button>
              ) : null}
              {av.buttons.endQuestion ? (
                <Button size="lg" variant="secondary" loading={busy === "endq"} onClick={() => send({ type: "END_QUESTION" }, "endq")}>
                  ⏹ Lock answers now
                </Button>
              ) : null}
              {av.buttons.adjustTime ? (
                <span className="flex gap-2">
                  {[10, 30].map((d) => (
                    <Button key={d} size="lg" variant="secondary" loading={busy === `t${d}`} onClick={() => send({ type: "ADJUST_TIME", delta_sec: d }, `t${d}`)}>
                      +{d}s
                    </Button>
                  ))}
                  <Button size="lg" variant="ghost" loading={busy === "t-10"} onClick={() => send({ type: "ADJUST_TIME", delta_sec: -10 }, "t-10")}>
                    −10s
                  </Button>
                </span>
              ) : null}
              {av.buttons.revealAnswer ? (
                <Button size="lg" loading={busy === "reveal"} onClick={() => send({ type: "REVEAL_ANSWER" }, "reveal")}>
                  👁 Reveal answer
                </Button>
              ) : null}
              {av.buttons.showLeaderboard ? (
                <Button size="lg" variant={snap.phase === "REVEAL_ANSWER" && !isLast ? "secondary" : "primary"} loading={busy === "lb"} onClick={() => send({ type: "SHOW_LEADERBOARD" }, "lb")}>
                  🏆 {snap.phase === "QUALIFICATION_REVEAL" ? "Show full table" : "Leaderboard"}
                </Button>
              ) : null}
            </div>

            {av.buttons.startQuestion && status?.next_question ? (
              <div className="mt-5 flex flex-wrap items-start gap-4 rounded-xl border border-line p-4">
                {status.next_question.media_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={status.next_question.media_url} alt="" className="h-16 w-24 rounded-lg bg-ink object-cover" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-widest text-muted">Next up · Q{status.next_question.index + 1}</p>
                  <p className="mt-1 font-semibold">{status.next_question.question_text}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">Time:</span>
                    <button
                      type="button"
                      onClick={() => setTimeOverride(null)}
                      className={cx("h-8 rounded-lg border px-3 text-sm", timeOverride === null ? "border-gold bg-gold/15 text-gold" : "border-line text-muted hover:text-white")}
                    >
                      As set ({status.next_question.time_limit_sec}s)
                    </button>
                    {[10, 20, 30, 45, 60, 90, 120].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTimeOverride(t)}
                        className={cx("h-8 min-w-11 rounded-lg border px-2.5 text-sm tabular", timeOverride === t ? "border-gold bg-gold/15 text-gold" : "border-line text-muted hover:text-white")}
                      >
                        {t}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {av.buttons.showQualification ? (
              <div className={cx("mt-5 flex flex-wrap items-end gap-3 rounded-xl border p-4", isLast ? "border-gold/50 bg-gold/5" : "border-line")}>
                <label className="block">
                  <span className="mb-1 block text-sm text-muted">Teams that qualify</span>
                  <input type="number" min={1} className={inputCls("w-32")} value={qualifyCount} onChange={(e) => setQualifyCount(Math.max(1, Number(e.target.value) || 1))} />
                </label>
                <Button variant={isLast ? "primary" : "secondary"} loading={busy === "qual"} onClick={() => send({ type: "SHOW_QUALIFICATION", qualify_count: qualifyCount }, "qual")}>
                  🎬 Reveal qualified teams
                </Button>
                <p className="text-sm text-muted">{isLast ? "That was the last question." : "You can also do this mid-game, e.g. at the end of a round."}</p>
              </div>
            ) : null}
            <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
          </Card>

          {/* ---------------- After the game: keep or delete the pack ---------------- */}
          {snap.phase === "ENDED" && snap.quiz_pack_id ? (
            <Card className="p-5">
              <h2 className="font-headline text-xl font-bold">Question pack</h2>
              {packAction === "deleted" ? (
                <p className="mt-2 text-good">✔ The pack was deleted from your question bank.</p>
              ) : (
                <>
                  <p className="mt-2 text-muted">
                    “{packs?.find((p) => p.quiz_pack_id === snap.quiz_pack_id)?.title ?? snap.quiz_pack_id}” is still saved in your question bank and can be
                    used again any time. Packs are only deleted when you choose to.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {packAction === "confirm" || packAction === "deleting" ? (
                      <>
                        <span className="text-sm">Delete the pack and all its questions for good?</span>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={packAction === "deleting"}
                          onClick={async () => {
                            setPackAction("deleting");
                            setError(null);
                            try {
                              await api(`/api/admin/packs/${encodeURIComponent(snap.quiz_pack_id!)}`, { method: "DELETE" });
                              setPackAction("deleted");
                            } catch (e) {
                              setError((e as ApiError).message);
                              setPackAction("idle");
                            }
                          }}
                        >
                          Yes, delete it
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPackAction("kept")}>Keep it</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setPackAction("kept")} disabled={packAction === "kept"}>
                          {packAction === "kept" ? "✔ Kept" : "Keep for next time"}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setPackAction("confirm")}>Delete this pack…</Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {/* ---------------- Current question (host sees the answer) ---------------- */}
          {q ? (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">
                  Q{q.index + 1} · {TYPE_LABEL[q.type] ?? q.type} · {q.time_limit_sec}s
                </p>
                <p className="text-xs uppercase tracking-widest text-gold">Host view — answer visible</p>
              </div>
              <div className="mt-2 flex flex-wrap items-start gap-4">
                {q.media_url && q.media_type !== "audio" && q.media_type !== "video" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={q.media_url} alt="" className="h-24 rounded-lg bg-ink object-contain" />
                ) : q.media_url ? (
                  <span className="rounded-lg bg-panel-2 px-3 py-2 text-sm">{q.media_type === "audio" ? "🎵 Sound plays on the stage" : "🎬 Video plays on the stage"}</span>
                ) : null}
                <p className="min-w-0 flex-1 font-display text-2xl font-semibold">{q.question_text}</p>
              </div>
              {q.choices ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {q.choices.map((c) => (
                    <div key={c.choice_id} style={choiceTileStyle(c.choice_id)} className={cx("flex items-center gap-3 rounded-xl border-2 p-3 text-white", !correct.has(c.choice_id) && "opacity-40")}>
                      <ChoiceBadge id={c.choice_id} className="h-8 w-8 text-base" />
                      {c.media_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.media_url} alt="" className="h-10 w-14 rounded bg-black/20 object-cover" />
                      ) : null}
                      <span className="flex-1 font-semibold">{c.text}</span>
                      {correct.has(c.choice_id) ? <span>✔</span> : null}
                    </div>
                  ))}
                </div>
              ) : q.sub_questions ? (
                <ol className="mt-3 space-y-1.5">
                  {q.sub_questions.map((sq, i) => {
                    const ans = statusSameQ ? status?.current_answer?.sub_questions?.[i]?.correct_answers_array : null;
                    return (
                      <li key={sq.sub_id} className="flex flex-wrap items-baseline gap-x-3 rounded-lg bg-ink/50 px-3 py-2">
                        <span className="text-muted tabular">{i + 1}.</span>
                        <span className="font-semibold">{sq.prompt}</span>
                        <span className="text-good">→ {ans ? ans.join(" · ") : "…"}</span>
                        <span className="ml-auto text-xs text-muted tabular">{sq.points} pts</span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="mt-3 text-lg">
                  <span className="text-muted">Accepted: </span>
                  <b className="text-good">{statusSameQ ? status?.current_answer?.correct_answers_array.join(" · ") : "…"}</b>
                </p>
              )}
            </Card>
          ) : (
            <Card className="flex flex-wrap items-center gap-6 p-5">
              <QrCode value={joinUrl} className="h-36 w-36 overflow-hidden rounded-xl bg-white p-1.5" />
              <div>
                <p className="text-muted">Players join at</p>
                <p className="break-all font-display text-xl font-semibold">{joinUrl}</p>
                <p className="mt-2 text-sm text-muted">Open the stage on the projector — it shows this code and QR too.</p>
              </div>
            </Card>
          )}
        </div>

        {/* ---------------- Teams ---------------- */}
        <Card className="p-5">
          <h2 className="font-headline text-xl font-bold">Teams ({teamCount})</h2>
          {!status ? (
            <Spinner className="mt-4" />
          ) : status.teams.length === 0 ? (
            <p className="mt-4 text-muted">Waiting for teams to join…</p>
          ) : (
            <ul className="mt-3 max-h-[70vh] divide-y divide-line overflow-y-auto pr-1">
              {status.teams.map((t) => {
                const qFlags = t.flags.filter((f) => f.question_index === snap.current_question_index);
                return (
                  <li key={t.team_id} className="flex items-center gap-3 py-2">
                    <span className="w-8 text-right text-sm text-muted tabular">{t.rank ?? "–"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{t.name}</span>
                      {t.flags.length ? (
                        <span className="text-xs text-bad" title={t.flags.map((f) => `Q${f.question_index + 1}: ${f.kind}${f.duration_ms ? ` ${Math.round(f.duration_ms / 1000)}s` : ""}`).join("\n")}>
                          ⚠ {t.flags.length} flag{t.flags.length > 1 ? "s" : ""}
                          {qFlags.length ? " (this question)" : ""}
                        </span>
                      ) : null}
                    </span>
                    {snap.phase === "PLAYING" || snap.phase === "SUBMITTED_WAITING" ? (
                      t.frozen_now ? (
                        <span className="text-xs font-bold text-bad">VOIDED</span>
                      ) : t.answered ? (
                        <span className="text-good" title={t.answer?.join(", ")}>✔</span>
                      ) : (
                        <span className="text-muted">…</span>
                      )
                    ) : null}
                    <span className="w-14 text-right font-mono font-bold tabular">{t.score}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}

const TYPE_LABEL: Record<string, string> = {
  MCQ_SINGLE: "One answer",
  MCQ_MULTI: "Several answers",
  TEXT_INPUT: "Typed answer",
  SUB_QUESTIONS_TEXT: "Sub-questions",
};

function phaseHeadline(p: PublicSnapshot["phase"]): string {
  switch (p) {
    case "WAITING": return "Lobby — teams are joining";
    case "PLAYING": return "Question is live";
    case "SUBMITTED_WAITING": return "Answers locked — ready to reveal";
    case "REVEAL_ANSWER": return "Answer revealed";
    case "LEADERBOARD": return "Showing leaderboard";
    case "QUALIFICATION_REVEAL": return "Qualification reveal";
    case "ENDED": return "Game over";
  }
}
