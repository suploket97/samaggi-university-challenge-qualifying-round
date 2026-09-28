"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { PublicSnapshot } from "@/lib/game/engine";
import type { ChoiceId, PublicQuestion } from "@/lib/game/types";
import { playerView, type PlayerView } from "@/lib/game/projections";
import { apiTimed, ApiError, clearSession, loadSession, teamHeaders, type TeamSession } from "@/lib/client/api";
import { useAntiCheat, useAutoTick, useNow, useRoom } from "@/lib/client/hooks";
import { Button, ConnectionDot, LoadingDots, Logo, Spinner, cx, inputClass } from "@/components/ui";
import { ChoiceBadge, QuestionMedia, SafeImage, TimerBar, ZoomOverlay, choiceTileStyle, phoneQuestionSize } from "@/components/game";
import { Particles } from "@/components/Particles";
import { Odometer } from "@/components/Odometer";

interface MeResponse {
  snapshot: PublicSnapshot;
  me: { team_id: string; name: string; has_submitted: boolean; my_answer: string[] | null; frozen: boolean };
}

export default function PlayerPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code ?? "").toUpperCase();
  const router = useRouter();
  const [session, setSession] = useState<TeamSession | null>(null);

  useEffect(() => {
    const s = loadSession(code);
    if (!s) router.replace(`/play?code=${code}`);
    else setSession(s);
  }, [code, router]);

  if (!session) {
    return (
      <div className="grid min-h-dvh place-items-center text-muted">
        <Spinner />
      </div>
    );
  }
  return <PlayerController code={code} session={session} />;
}

function PlayerController({ code, session }: { code: string; session: TeamSession }) {
  const router = useRouter();
  // Per-question local state. Keyed by question index so a new question resets it.
  const [answered, setAnswered] = useState<{ index: number; answer: string[] } | null>(null);
  const [frozenIndex, setFrozenIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const loader = useCallback(async () => {
    try {
      const r = await apiTimed<MeResponse>(`/api/rooms/${code}/me`, { headers: teamHeaders(session) });
      const idx = r.data.snapshot.current_question_index;
      if (r.data.me.has_submitted) setAnswered({ index: idx, answer: r.data.me.my_answer ?? [] });
      if (r.data.me.frozen) setFrozenIndex(idx);
      return { snapshot: r.data.snapshot, localMid: r.localMid };
    } catch (e) {
      if ((e as ApiError).status === 401) {
        clearSession(code);
        router.replace(`/play?code=${code}`);
      }
      throw e;
    }
  }, [code, session, router]);

  const room = useRoom(code, loader);
  const { snapshot, offset } = room;
  // Players only close the question if no stage/admin did it first (jittered to spread load).
  const jitter = useRef(3000 + Math.floor(Math.random() * 3000)).current;
  useAutoTick(code, room, jitter);
  const now = useNow(200);
  const serverNow = now + offset;

  const idx = snapshot?.current_question_index ?? -1;
  useEffect(() => {
    setNotice(null);
  }, [idx, snapshot?.phase]);

  const view: PlayerView | null = snapshot
    ? playerView(
        snapshot,
        { team_id: session.team_id, has_submitted: answered?.index === idx, frozen: frozenIndex === idx },
        serverNow,
      )
    : null;

  // Anti-cheat while answering.
  const report = useCallback(
    (duration: number, kind: "FOCUS_LOST" | "PASTE_ATTEMPT") => {
      const qIndex = idx;
      fetch(`/api/rooms/${code}/focus`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", ...teamHeaders(session) },
        body: JSON.stringify({ duration_ms: duration, kind }),
      })
        .then((r) => r.json())
        .then((r: { frozen?: boolean }) => {
          if (r.frozen) setFrozenIndex(qIndex);
        })
        .catch(() => {});
    },
    [code, session, idx],
  );
  useAntiCheat({
    active: view?.screen === "ANSWER",
    thresholdMs: snapshot?.settings.focus_violation_ms ?? 3000,
    report,
  });

  async function submit(answer: string[]) {
    if (sending || answered?.index === idx) return;
    const qIndex = idx;
    setSending(true);
    setAnswered({ index: qIndex, answer }); // lock immediately
    try {
      const r = await apiTimed<{ ok: boolean; reason?: string; message?: string }>(`/api/rooms/${code}/answer`, {
        method: "POST",
        json: { answer },
        headers: teamHeaders(session),
      });
      if (!r.data.ok && r.data.reason !== "ALREADY_ANSWERED") setNotice(r.data.message ?? "Answer not accepted");
    } catch (e) {
      const ae = e as ApiError;
      const body = (ae.body ?? {}) as { reason?: string; message?: string };
      if (body.reason === "FROZEN") {
        setFrozenIndex(qIndex);
      } else if (body.reason === "NOT_ACCEPTING") {
        setNotice(body.message ?? "Too late — answers are locked.");
      } else if (body.reason === "INVALID_ANSWER" || !ae.status) {
        setAnswered(null); // let them try again
        setNotice(body.message ?? "Couldn't send your answer — check your connection and try again.");
      } else {
        setNotice(ae.message);
      }
    } finally {
      setSending(false);
    }
  }

  const row = snapshot?.leaderboard.find((r) => r.team_id === session.team_id);

  return (
    <div className="no-select flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line/60 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold">{session.name}</p>
          <p className="text-xs text-muted">
            Room {code}
            {row ? ` · ${row.score} pts · #${row.rank}` : ""}
          </p>
        </div>
        <ConnectionDot connected={room.connected} />
      </header>

      <main className="flex flex-1 flex-col px-4 py-5">
        {room.notFound ? (
          <Centered>
            <p className="font-headline text-2xl font-bold">This room has closed.</p>
            <Button className="mt-6" onClick={() => router.push("/play")}>Join another</Button>
          </Centered>
        ) : !view || !snapshot ? (
          <Centered>
            <Spinner className="h-8 w-8 text-muted" />
          </Centered>
        ) : (
          <Screen
            view={view}
            snapshot={snapshot}
            myAnswer={answered?.index === idx ? answered.answer : null}
            onSubmit={submit}
            sending={sending}
            reportPaste={() => report(0, "PASTE_ATTEMPT")}
          />
        )}
        {notice ? <p className="mt-4 rounded-xl border border-bad/40 bg-bad/10 p-3 text-center text-sm text-bad">{notice}</p> : null}
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center text-center">{children}</div>;
}

function Screen({
  view, snapshot, myAnswer, onSubmit, sending, reportPaste,
}: {
  view: PlayerView;
  snapshot: PublicSnapshot;
  myAnswer: string[] | null;
  onSubmit: (a: string[]) => void;
  sending: boolean;
  reportPaste: () => void;
}) {
  switch (view.screen) {
    case "LOBBY":
      return (
        <Centered>
          <Logo className="text-xl" />
          <p className="mt-10 font-headline text-3xl font-bold">You&apos;re in!</p>
          <p className="mt-3 text-muted">Watch the big screen. The first question will appear here.</p>
          <LoadingDots className="mt-10 text-gold" />
        </Centered>
      );

    case "ANSWER":
      return <AnswerScreen key={view.question.question_id} q={view.question} remainingMs={view.remaining_ms} onSubmit={onSubmit} sending={sending} reportPaste={reportPaste} />;

    case "LOCKED_WAITING": {
      const q = snapshot.current_question;
      const text =
        myAnswer && q
          ? q.type === "TEXT_INPUT"
            ? `“${myAnswer[0]}”`
            : q.type === "SUB_QUESTIONS_TEXT"
            ? `${myAnswer.filter((a) => a.trim()).length} of ${myAnswer.length} parts`
            : myAnswer.map((id) => `${id}${q.choices?.find((c) => c.choice_id === id) ? ` · ${q.choices.find((c) => c.choice_id === id)!.text}` : ""}`).join(", ")
          : null;
      return (
        <Centered>
          {view.reason === "FROZEN" ? (
            <>
              <div className="text-6xl">🚫</div>
              <p className="mt-6 font-headline text-3xl font-bold text-bad">Answer voided</p>
              <p className="mt-3 max-w-xs text-muted">You left the quiz screen for too long during this question. Stay on this page for the next one!</p>
            </>
          ) : (
            <>
              <div className="relative grid h-28 w-28 place-items-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-gold/20" />
                <span className="relative grid h-24 w-24 place-items-center rounded-full bg-gold text-5xl text-ink">
                  {view.reason === "SUBMITTED" ? "🔒" : "⏱"}
                </span>
              </div>
              <p className="mt-8 font-headline text-3xl font-bold">{view.reason === "SUBMITTED" ? "Answer locked in" : "Time's up!"}</p>
              {text ? <p className="mt-3 max-w-xs break-words text-lg text-muted">You said {text}</p> : null}
              <p className="mt-8 text-muted">Waiting for the reveal</p>
              <LoadingDots className="mt-3 text-gold" />
            </>
          )}
        </Centered>
      );
    }

    case "RESULT": {
      const map = {
        CORRECT: { icon: "✔️", title: "CORRECT", cls: "bg-good text-ink" },
        PARTIAL: { icon: "➗", title: "PARTLY RIGHT", cls: "bg-partial text-ink" },
        INCORRECT: { icon: "❌", title: "INCORRECT", cls: "bg-bad text-white" },
        NO_ANSWER: { icon: "💤", title: "NO ANSWER", cls: "bg-panel-2 text-white" },
        VOIDED: { icon: "🚫", title: "VOIDED", cls: "bg-panel-2 text-bad" },
      }[view.outcome];
      const parts =
        view.sub_correct && snapshot.current_question?.sub_questions
          ? snapshot.current_question.sub_questions.map((sq, i) => ({ prompt: sq.prompt, ok: !!view.sub_correct![i], points: sq.points }))
          : null;
      return <ResultPanel {...map} outcome={view.outcome} points={view.points} rank={view.rank} teamCount={view.team_count} parts={parts} />;
    }

    case "STANDING":
      return (
        <Centered>
          <p className="text-sm uppercase tracking-[0.3em] text-muted">Your position</p>
          <p className="mt-4 font-mono text-8xl font-black text-gold tabular animate-pop">{view.rank ? `#${view.rank}` : "–"}</p>
          <p className="mt-2 text-muted">of {view.team_count} teams</p>
          {view.movement ? (
            <p className={cx("mt-4 font-bold", view.movement > 0 ? "text-good" : "text-bad")}>
              {view.movement > 0 ? `▲ up ${view.movement}` : `▼ down ${-view.movement}`}
            </p>
          ) : null}
          <p className="mt-8 text-4xl">
            <Odometer key={`${view.previous_score}:${view.score}`} from={view.previous_score ?? 0} value={view.score} delayMs={400} />
            <span className="ml-2 text-xl text-muted">pts</span>
          </p>
        </Centered>
      );

    case "QUALIFICATION":
      return view.passed ? (
        <div className="bg-metal-gold relative -mx-4 -my-5 flex flex-1 flex-col items-center justify-center overflow-hidden px-6 text-center">
          <Particles tone="gold" count={30} />
          <div className="relative text-7xl animate-pop">🏆</div>
          <p className="text-metal-gold relative mt-6 font-headline text-6xl animate-rise">Qualified</p>
          <p className="relative mt-3 text-lg font-semibold text-[#ffe99a]">
            You finished <span className="font-mono">#{view.rank}</span>. You&apos;re through!
          </p>
        </div>
      ) : (
        <div className="-mx-4 -my-5 flex flex-1 flex-col items-center justify-center border-t-4 border-bad bg-ink px-6 text-center text-white">
          <div className="text-7xl grayscale">🍺</div>
          <p className="mt-6 font-headline text-6xl text-bad animate-rise">Eliminated</p>
          <p className="mt-3 text-lg text-white/80">You finished {view.rank ? `#${view.rank}` : "outside the top"}. Good game!</p>
        </div>
      );

    case "ENDED":
      return (
        <Centered>
          <p className="font-headline text-4xl font-bold">Thanks for playing!</p>
          {view.rank ? <p className="mt-4 text-xl text-muted">Final position #{view.rank} · {view.score} pts</p> : null}
        </Centered>
      );
  }
}

function ResultPanel({
  icon, title, cls, outcome, points, rank, teamCount, parts,
}: {
  icon: string; title: string; cls: string; outcome: string; points: number; rank: number | null; teamCount: number;
  /** SUB_QUESTIONS_TEXT: each part, right or wrong. */
  parts: { prompt: string; ok: boolean; points: number }[] | null;
}) {
  useEffect(() => {
    try {
      navigator.vibrate?.(outcome === "CORRECT" ? [60, 40, 60] : outcome === "INCORRECT" ? 200 : 0);
    } catch {
      /* not supported */
    }
  }, [outcome]);
  return (
    <div className={cx("-mx-4 -my-5 flex flex-1 flex-col items-center justify-center px-6 text-center", cls)}>
      <div className={cx("text-8xl", outcome === "INCORRECT" ? "animate-shake" : "animate-pop")}>{icon}</div>
      <p className="mt-6 font-headline text-5xl font-black tracking-tight">{title}</p>
      <p className="mt-4 font-mono text-3xl font-bold tabular">+{points}</p>
      {parts ? (
        <ul className="mt-5 w-full max-w-xs space-y-1.5 text-left">
          {parts.map((p, i) => (
            <li key={i} className="flex items-center gap-2 rounded-xl bg-black/15 px-3 py-2 text-sm font-semibold">
              <span className="w-5 text-center">{p.ok ? "✔" : "✘"}</span>
              <span className="min-w-0 flex-1 truncate">{i + 1}. {p.prompt}</span>
              <span className="tabular opacity-80">{p.ok ? `+${p.points}` : "0"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rank ? (
        <p className="mt-8 rounded-full bg-black/15 px-5 py-2 font-semibold">
          You&apos;re #{rank} of {teamCount}
        </p>
      ) : null}
    </div>
  );
}

function AnswerScreen({
  q, remainingMs, onSubmit, sending, reportPaste,
}: {
  q: PublicQuestion;
  remainingMs: number;
  onSubmit: (a: string[]) => void;
  sending: boolean;
  reportPaste: () => void;
}) {
  const [picked, setPicked] = useState<ChoiceId[]>([]);
  const [text, setText] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.type === "TEXT_INPUT") inputRef.current?.focus();
  }, [q.type]);

  const header = (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between text-sm text-muted">
        <span>
          Question {q.index + 1} / {q.total}
        </span>
        <span className="font-mono text-lg font-bold tabular text-white">{Math.ceil(remainingMs / 1000)}s</span>
      </div>
      <TimerBar remainingMs={remainingMs} totalSec={q.time_limit_sec} />
      <p className={cx("mt-4 whitespace-pre-line break-words font-display font-semibold leading-snug", phoneQuestionSize(q.question_text))}>{q.question_text}</p>
      {q.show_media_on_player && q.media_url ? (
        <div className="mt-3 flex flex-col items-center">
          <QuestionMedia q={q} autoPlay={false} className="max-h-[38dvh] w-auto" onZoom={() => setZoom(q.media_url)} />
          {q.media_type !== "audio" && q.media_type !== "video" ? <p className="mt-1 text-xs text-muted">Tap the picture to zoom</p> : null}
        </div>
      ) : q.media_url ? (
        <p className="mt-2 text-sm text-gold">👀 Look at the big screen</p>
      ) : null}
      {zoom ? <ZoomOverlay src={zoom} onClose={() => setZoom(null)} /> : null}
    </div>
  );
  const pictureChoices = (q.choices ?? []).some((c) => c.media_url);

  const choices = useMemo(() => q.choices ?? [], [q.choices]);

  if (q.type === "MCQ_SINGLE") {
    return (
      <div className="flex flex-1 flex-col">
        {header}
        <div className={cx("grid flex-1 content-start gap-3", choices.length > 4 || pictureChoices ? "grid-cols-2" : "grid-cols-1", choices.length > 12 && "gap-2")}>
          {choices.map((c) => (
            <button
              key={c.choice_id}
              disabled={sending}
              onClick={() => onSubmit([c.choice_id])}
              className={cx(
                "flex gap-3 rounded-2xl border-2 p-3 text-left text-white shadow-lg transition active:scale-[0.97]",
                choices.length > 12 ? "min-h-12" : "min-h-16",
                c.media_url ? "flex-col items-stretch" : "items-center",
              )}
              style={choiceTileStyle(c.choice_id)}
            >
              <span className="flex items-center gap-2">
                <ChoiceBadge id={c.choice_id} />
                {c.text ? <span className="text-lg font-semibold leading-tight">{c.text}</span> : null}
              </span>
              {c.media_url ? <SafeImage src={c.media_url} className="aspect-[4/3] w-full rounded-xl bg-black/20 object-cover" /> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (q.type === "MCQ_MULTI") {
    const toggle = (id: ChoiceId) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    return (
      <div className="flex flex-1 flex-col">
        {header}
        <p className="mb-3 text-sm text-gold">Select all that apply, then press Submit.</p>
        <div className={cx("grid flex-1 content-start gap-3", (pictureChoices || choices.length > 6) && "grid-cols-2")}>
          {choices.map((c) => {
            const on = picked.includes(c.choice_id);
            return (
              <button
                key={c.choice_id}
                onClick={() => toggle(c.choice_id)}
                aria-pressed={on}
                className={cx(
                  "flex min-h-14 items-center gap-3 rounded-2xl border-2 p-3 text-left text-white transition active:scale-[0.98]",
                  on ? "ring-2 ring-gold" : "opacity-80",
                )}
                style={choiceTileStyle(c.choice_id, on ? 0.45 : 0.18)}
              >
                <ChoiceBadge id={c.choice_id} />
                {c.media_url ? <SafeImage src={c.media_url} className="h-16 min-w-0 flex-1 rounded-lg bg-black/20 object-cover" /> : null}
                {c.text ? <span className="flex-1 text-lg font-semibold leading-tight">{c.text}</span> : null}
                <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg border-2 border-white text-lg", on && "bg-white text-ink")}>{on ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
        <Button size="lg" className="mt-5 w-full" disabled={picked.length === 0} loading={sending} onClick={() => onSubmit([...picked].sort())}>
          Submit {picked.length ? `(${picked.length})` : ""}
        </Button>
      </div>
    );
  }

  if (q.type === "SUB_QUESTIONS_TEXT") {
    return <SubQuestionsForm q={q} header={header} onSubmit={onSubmit} sending={sending} reportPaste={reportPaste} />;
  }

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit([text.trim()]);
      }}
    >
      {header}
      <input
        ref={inputRef}
        className={`${inputClass} h-16 text-xl`}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 200))}
        onPaste={(e) => {
          e.preventDefault();
          reportPaste();
        }}
        onDrop={(e) => e.preventDefault()}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="send"
        placeholder="Type your answer"
      />
      <p className="mt-2 text-xs text-muted">Small typos are OK. Pasting is disabled.</p>
      <Button type="submit" size="lg" className="mt-5 w-full" disabled={!text.trim()} loading={sending}>
        Submit answer
      </Button>
    </form>
  );
}

/** SUB_QUESTIONS_TEXT: one answer box per part, sent together with one Submit. */
function SubQuestionsForm({
  q, header, onSubmit, sending, reportPaste,
}: {
  q: PublicQuestion;
  header: React.ReactNode;
  onSubmit: (a: string[]) => void;
  sending: boolean;
  reportPaste: () => void;
}) {
  const parts = q.sub_questions ?? [];
  const [values, setValues] = useState<string[]>(() => parts.map(() => ""));
  const filled = values.filter((v) => v.trim()).length;
  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (filled > 0) onSubmit(values.map((v) => v.trim()));
      }}
    >
      {header}
      <p className="mb-3 text-sm text-gold">Answer each part. Every part is marked on its own and the points add up.</p>
      <ol className="space-y-3">
        {parts.map((sq, i) => (
          <li key={sq.sub_id}>
            <label className="block">
              <span className="mb-1.5 flex items-baseline gap-2 text-base">
                <span className="shrink-0 font-bold text-gold tabular">{i + 1}.</span>
                <span className="min-w-0 flex-1 whitespace-pre-line break-words font-semibold leading-snug">{sq.prompt}</span>
                <span className="shrink-0 text-[11px] text-muted tabular">{sq.points} pts</span>
              </span>
              <input
                className={`${inputClass} h-12 text-lg`}
                value={values[i]}
                onChange={(e) => {
                  const v = e.target.value.slice(0, 200);
                  setValues((vs) => vs.map((x, j) => (j === i ? v : x)));
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  reportPaste();
                }}
                onDrop={(e) => e.preventDefault()}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint={i === parts.length - 1 ? "send" : "next"}
                placeholder={`Answer ${i + 1}`}
              />
            </label>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted">Small typos are OK. Leave a part blank if you don&apos;t know it. Pasting is disabled.</p>
      <Button type="submit" size="lg" className="mt-4 w-full" disabled={filled === 0} loading={sending}>
        Submit {filled} of {parts.length} answers
      </Button>
    </form>
  );
}
