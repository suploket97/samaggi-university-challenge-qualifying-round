"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { stageView, type StageView } from "@/lib/game/projections";
import { useAutoTick, useNow, usePoll, useRoom } from "@/lib/client/hooks";
import { ConnectionDot, Logo, Spinner, cx } from "@/components/ui";
import { Countdown, FitText, QuestionMedia, SafeImage, StageChoice, stageChoiceColumns } from "@/components/game";
import { Leaderboard } from "@/components/Leaderboard";
import { QualificationReveal } from "@/components/QualificationReveal";
import { TieBreakReveal } from "@/components/TieBreak";
import { QrCode } from "@/components/QrCode";
import { Particles } from "@/components/Particles";
import type { MediaControl, ScoreRow } from "@/lib/game/types";

interface PublicStatus {
  phase: string;
  team_count: number;
  team_names: string[];
  answered_count: number;
}

export default function StagePage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code ?? "").toUpperCase();
  const room = useRoom(code);
  useAutoTick(code, room, 200);
  const now = useNow(100);
  const snapshot = room.snapshot;
  const phase = snapshot?.phase;
  const pollActive = phase === "WAITING" || phase === "PLAYING" || phase === "SUBMITTED_WAITING";
  const { data: status } = usePoll<PublicStatus>(`/api/rooms/${code}/status`, 2000, pollActive);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  if (room.notFound) {
    return <Full><p className="font-headline text-4xl text-muted">Room {code} not found.</p></Full>;
  }
  if (!snapshot) {
    return <Full><Spinner className="h-10 w-10 text-muted" /></Full>;
  }

  const view = stageView(snapshot, now + room.offset);
  const joinUrl = `${origin}/play?code=${code}`;

  return (
    <div className="no-select flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center justify-between px-8 py-4">
        <Logo className="text-2xl" />
        <div className="flex items-center gap-6 text-muted">
          {snapshot.current_question && view.screen !== "LOBBY" ? (
            <span className="font-headline text-xl font-semibold">
              Question {snapshot.current_question.index + 1} / {snapshot.total_questions}
            </span>
          ) : null}
          {view.screen !== "LOBBY" ? (
            <span className="rounded-lg border border-line px-3 py-1 font-mono font-bold tracking-widest text-white">{code}</span>
          ) : null}
          <ConnectionDot connected={room.connected} />
          <FullscreenButton />
        </div>
      </header>
      <main className="min-h-0 flex-1 px-8 pb-8">
        <StageScreen view={view} status={status} joinUrl={joinUrl} code={code} standings={snapshot.leaderboard} media={snapshot.media ?? null} />
      </main>
    </div>
  );
}

function Full({ children }: { children: React.ReactNode }) {
  return <div className="grid h-dvh place-items-center">{children}</div>;
}

function FullscreenButton() {
  return (
    <button
      className="rounded-lg px-2 py-1 text-sm hover:bg-white/10"
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      }}
      title="Toggle fullscreen"
    >
      ⛶
    </button>
  );
}

function StageScreen({
  view,
  status,
  joinUrl,
  code,
  standings,
  media,
}: {
  view: StageView;
  status: PublicStatus | null;
  joinUrl: string;
  code: string;
  standings: ScoreRow[];
  media: MediaControl | null;
}) {
  switch (view.screen) {
    case "LOBBY":
      return (
        <div className="grid h-full grid-cols-1 gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col justify-center">
            <p className="font-headline text-3xl text-muted">Join on your phone at</p>
            <p className="mt-2 break-all font-display text-3xl font-semibold text-white">{joinUrl.replace(/^https?:\/\//, "").replace(/\?code=.*/, "")}</p>
            <p className="mt-8 font-headline text-2xl text-muted">Room code</p>
            <p className="font-headline text-[9rem] font-black leading-none tracking-[0.12em] text-gold">{code}</p>
            <div className="mt-8 flex items-center gap-6">
              <QrCode value={joinUrl} className="h-48 w-48 overflow-hidden rounded-2xl bg-white p-2" />
              <p className="max-w-xs text-xl text-muted">…or scan to join straight away</p>
            </div>
          </div>
          <div className="flex min-h-0 flex-col rounded-3xl border border-line bg-panel/60 p-8">
            <p className="font-headline text-3xl font-bold">
              <span className="text-gold tabular">{status?.team_count ?? 0}</span> teams in
            </p>
            <div className="mt-6 flex min-h-0 flex-1 flex-wrap content-start gap-3 overflow-hidden">
              {(status?.team_names ?? []).map((n) => (
                <span key={n} className="rounded-full bg-panel-2 px-4 py-2 font-headline text-xl font-semibold animate-pop">
                  {n}
                </span>
              ))}
            </div>
          </div>
        </div>
      );

    case "QUESTION":
    case "LOCKED": {
      const q = view.question;
      const locked = view.screen === "LOCKED";
      const remaining = view.screen === "QUESTION" ? view.remaining_ms : 0;
      const hasMedia = !!q.media_url;
      const choiceImages = !!q.choices?.some((c) => c.media_url);
      return (
        <div className="flex h-full flex-col gap-5">
          <div className="flex items-start gap-8">
            <FitText
              as="h1"
              watch={q.question_text}
              max={hasMedia ? 48 : 60}
              min={18}
              maxHeight={q.choices || q.sub_questions ? (hasMedia ? "26vh" : "32vh") : hasMedia ? "24vh" : "60vh"}
              className={cx(
                "flex-1 whitespace-pre-line break-words font-display leading-snug",
                q.question_text.length > 250 ? "font-semibold" : "font-bold",
              )}
            >
              {q.question_text}
            </FitText>
            <div className="flex flex-col items-center gap-2">
              {locked ? (
                <div className="grid h-[140px] w-[140px] place-items-center rounded-full bg-bad/20 font-headline text-2xl font-bold text-bad animate-pop">
                  Time&apos;s up
                </div>
              ) : (
                <Countdown remainingMs={remaining} totalSec={q.time_limit_sec} size={140} />
              )}
              <p className="text-lg text-muted tabular">
                {status?.answered_count ?? 0} / {status?.team_count ?? 0} answered
              </p>
            </div>
          </div>
          {q.type === "MCQ_MULTI" ? <p className="-mt-2 text-2xl text-gold">Pick all that apply</p> : null}
          {q.type === "ORDERING" ? <p className="-mt-2 text-2xl text-gold">📱 Put these in order on your phone, first to last</p> : null}
          {q.type === "MATCHING" ? <p className="-mt-2 text-2xl text-gold">📱 Match each item to its partner on your phone</p> : null}
          <div
            className={cx(
              "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-6",
              hasMedia && (q.choices || q.sub_questions) && "grid-cols-[1.4fr_1fr]",
            )}
          >
            {hasMedia ? (
              <div className="flex min-h-0 flex-col items-center justify-center gap-3">
                <QuestionMedia q={q} className="max-h-full min-h-0 flex-1" control={media} />
                {!q.choices && !q.sub_questions ? <p className="shrink-0 font-display text-2xl text-muted">✍️ Type your answer on your phone</p> : null}
              </div>
            ) : null}
            {q.type === "ORDERING" && q.choices ? (
              <FitText as="ul" fill watch={q.choices.map((c) => c.text).join("\n")} max={34} min={14} className={cx("grid content-center gap-[0.4em]", q.choices.length > 6 && !hasMedia && "grid-cols-2")}>
                {q.choices.map((c) => (
                  <li key={c.choice_id} className="flex items-center gap-[0.6em] rounded-2xl border-2 border-line bg-panel/70 px-[0.7em] py-[0.4em]">
                    {c.media_url ? <SafeImage src={c.media_url} className="h-[2.4em] w-[3.2em] shrink-0 rounded-lg bg-black/20 object-cover" /> : null}
                    <span className="min-w-0 flex-1 break-words font-display font-semibold leading-snug">{c.text}</span>
                  </li>
                ))}
              </FitText>
            ) : q.type === "MATCHING" && q.choices && q.match_left ? (
              <FitText
                as="div"
                fill
                watch={[...q.match_left, ...q.choices.map((c) => c.text)].join("\n")}
                max={32}
                min={14}
                className="grid grid-cols-2 content-center gap-x-[1.2em] gap-y-[0.4em]"
              >
                <ol className="space-y-[0.4em]">
                  {q.match_left.map((l, i) => (
                    <li key={i} className="flex items-baseline gap-[0.5em] rounded-2xl border-2 border-gold/50 bg-gold/10 px-[0.7em] py-[0.35em]">
                      <span className="font-display font-bold text-gold tabular">{i + 1}.</span>
                      <span className="min-w-0 flex-1 break-words font-display font-semibold leading-snug">{l}</span>
                    </li>
                  ))}
                </ol>
                <ul className="space-y-[0.4em]">
                  {q.choices.map((c) => (
                    <li key={c.choice_id} className="rounded-2xl border-2 border-line bg-panel/70 px-[0.7em] py-[0.35em] font-display font-semibold leading-snug break-words">
                      {c.text}
                    </li>
                  ))}
                </ul>
              </FitText>
            ) : q.choices ? (
              <div
                className={cx("grid min-h-0 content-center", q.choices.length > 8 ? "gap-2" : "gap-4", choiceImages && !hasMedia && "auto-rows-fr")}
                style={{ gridTemplateColumns: `repeat(${stageChoiceColumns(q.choices.length, hasMedia)}, minmax(0, 1fr))` }}
              >
                {q.choices.map((c) => (
                  <StageChoice key={c.choice_id} choice={c} state={locked ? "locked" : "open"} dense={q.choices!.length > 8} />
                ))}
              </div>
            ) : q.sub_questions ? (
              <div className="flex min-h-0 flex-col gap-3">
                <FitText
                  as="ol"
                  fill
                  watch={q.sub_questions.map((x) => x.prompt).join("\n")}
                  max={30}
                  min={14}
                  className={cx("grid content-start gap-[0.4em]", q.sub_questions.length > 6 && !hasMedia && "grid-cols-2")}
                >
                  {q.sub_questions.map((sq, i) => (
                    <li key={sq.sub_id} className="flex items-baseline gap-[0.6em] rounded-2xl border border-line bg-panel/70 px-[0.7em] py-[0.35em]">
                      <span className="font-display font-bold text-gold tabular">{i + 1}.</span>
                      <span className="min-w-0 flex-1 whitespace-pre-line break-words font-display font-semibold leading-snug">{sq.prompt}</span>
                      <span className="shrink-0 text-[0.6em] text-muted tabular">{sq.points} pts</span>
                    </li>
                  ))}
                </FitText>
                <p className="shrink-0 font-display text-2xl text-muted">✍️ Type an answer for each part on your phone</p>
              </div>
            ) : !hasMedia ? (
              <div className="grid place-items-center rounded-3xl border-2 border-dashed border-line">
                <p className="font-display text-4xl text-muted">✍️ Type your answer on your phone</p>
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    case "REVEAL": {
      const q = view.question;
      const totalAnswers = view.answer_distribution ? Object.values(view.answer_distribution).reduce((a, b) => a + b, 0) : 0;
      const picture = q.media_url && q.media_type !== "audio" && q.media_type !== "video" ? q.media_url : null;
      return (
        <div className="flex h-full flex-col gap-5">
          <FitText
            as="h1"
            watch={q.question_text}
            max={48}
            min={16}
            maxHeight={view.sub_reveal ? "20vh" : "26vh"}
            className="shrink-0 whitespace-pre-line break-words font-display font-bold leading-snug text-white/80"
          >
            {q.question_text}
          </FitText>
          <div className={cx("grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-6", picture && "grid-cols-[1fr_1.3fr]")}>
            {picture ? (
              <div className="flex min-h-0 items-center justify-center">
                <SafeImage src={picture} className="max-h-full max-w-full" />
              </div>
            ) : null}
            {view.sequence_reveal ? (
              <div className="flex min-h-0 flex-col gap-3">
                <FitText
                  as="ol"
                  fill
                  watch={view.sequence_reveal.map((x) => x.text).join("\n")}
                  max={34}
                  min={13}
                  className={cx("grid content-center gap-[0.35em]", view.sequence_reveal.length > 6 && !picture && "grid-cols-2")}
                >
                  {view.sequence_reveal.map((it, i) => (
                    <li key={i} className="flex items-center gap-[0.6em] rounded-2xl border-2 border-good/50 bg-good/10 px-[0.7em] py-[0.3em] animate-rise" style={{ animationDelay: `${i * 140}ms` }}>
                      <span className="grid h-[1.6em] w-[1.6em] shrink-0 place-items-center rounded-lg bg-good font-display font-bold text-ink tabular">{i + 1}</span>
                      {it.media_url ? <SafeImage src={it.media_url} className="h-[2.2em] w-[3em] shrink-0 rounded-lg bg-black/20 object-cover" /> : null}
                      <span className="min-w-0 flex-1 break-words font-display font-bold leading-snug text-white">{it.text}</span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-[0.7em] font-bold tabular">
                          {it.correct_teams}/{view.answered_team_count}
                        </span>
                        <span className="block text-[0.4em] text-muted">{q.type === "MATCHING" ? "matched" : "in place"}</span>
                      </span>
                    </li>
                  ))}
                </FitText>
                {view.host_accepted.length ? (
                  <p className="shrink-0 text-xl text-gold">Also accepted by the judges: {view.host_accepted.join(" · ")}</p>
                ) : null}
              </div>
            ) : view.sub_reveal ? (
              <FitText
                as="ol"
                watch={view.sub_reveal.map((x) => x.prompt + x.answer).join("\n")}
                max={30}
                min={13}
                className={cx("grid h-full min-h-0 content-center gap-[0.35em]", view.sub_reveal.length > 6 && !picture && "grid-cols-2")}
              >
                {view.sub_reveal.map((sr, i) => (
                  <li key={sr.sub_id} className="flex items-center gap-[0.6em] rounded-2xl border border-line bg-panel/70 px-[0.7em] py-[0.3em] animate-rise" style={{ animationDelay: `${i * 120}ms` }}>
                    <span className="font-display text-[0.8em] font-bold text-muted tabular">{i + 1}.</span>
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-pre-line break-words text-[0.6em] text-muted leading-snug">{sr.prompt}</span>
                      <span className="block break-words font-display font-bold text-good leading-snug">{sr.answer}</span>
                      {sr.aliases.length ? <span className="block text-[0.5em] text-muted">also: {sr.aliases.join(" · ")}</span> : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-[0.8em] font-bold tabular">{sr.correct_teams}</span>
                      <span className="block text-[0.45em] text-muted">teams</span>
                    </span>
                  </li>
                ))}
              </FitText>
            ) : q.choices ? (
              <div
                className={cx("grid content-center", q.choices.length > 8 ? "gap-2" : "gap-4")}
                style={{ gridTemplateColumns: `repeat(${stageChoiceColumns(q.choices.length, !!picture)}, minmax(0, 1fr))` }}
              >
                {q.choices.map((c) => (
                  <StageChoice
                    dense={q.choices!.length > 8}
                    key={c.choice_id}
                    choice={c}
                    state={view.correct_display.includes(c.choice_id) ? "correct" : "wrong"}
                    count={view.answer_distribution?.[c.choice_id] ?? 0}
                    total={totalAnswers}
                  />
                ))}
              </div>
            ) : (
              <div className="grid place-items-center">
                <div className="text-center animate-pop">
                  <p className="text-2xl uppercase tracking-[0.3em] text-muted">The answer is</p>
                  <p className={cx("mt-4 font-display font-black text-good", picture ? "text-7xl" : "text-8xl")}>{view.correct_display[0]}</p>
                  {view.accepted_aliases.length ? (
                    <p className="mt-6 text-2xl text-muted">Also accepted: {view.accepted_aliases.join(" · ")}</p>
                  ) : null}
                  {view.host_accepted.length ? (
                    <p className="mt-3 text-2xl text-gold">Also accepted by the judges: {view.host_accepted.join(" · ")}</p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-end justify-between gap-8">
            {view.explanation ? <p className="max-w-4xl text-2xl text-muted">💡 {view.explanation}</p> : <span />}
            <p className="shrink-0 font-headline text-3xl font-bold">
              <span className="text-good tabular">{view.correct_team_count}</span> {view.correct_team_count === 1 ? "team" : "teams"} got{" "}
              {view.sub_reveal ? "every part" : q.type === "ORDERING" ? "the whole order" : q.type === "MATCHING" ? "every match" : "it"}
            </p>
          </div>
        </div>
      );
    }

    case "LEADERBOARD":
      return (
        <div className="mx-auto flex h-full max-w-5xl flex-col">
          <h1 className="mb-6 text-center font-headline text-5xl font-black">
            Leaderboard <span className="text-2xl font-semibold text-muted">after {view.after_question} of {view.total}</span>
          </h1>
          <div className="min-h-0 flex-1 overflow-hidden">
            <Leaderboard rows={view.rows} limit={10} final={view.final} byScore={view.final} />
          </div>
        </div>
      );

    case "TIE_BREAK":
      return <TieBreakReveal tb={view.tie_break} />;

    case "QUALIFICATION":
      return <QualificationReveal qualified={view.qualified} eliminated={view.eliminated} qualifyCount={view.qualify_count} />;

    case "ENDED": {
      const champion = standings.find((r) => r.rank === 1);
      const runnersUp = standings.filter((r) => r.rank === 2 || r.rank === 3).slice(0, 3);
      if (!champion) {
        return (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="font-headline text-8xl">Thanks for playing!</p>
              <p className="mt-4 text-2xl text-muted">See you next time</p>
            </div>
          </div>
        );
      }
      // Championship moment: gold for the winner, silver for 2nd, bronze for 3rd.
      return (
        <div className="bg-metal-gold relative -mx-8 -mb-8 flex h-[calc(100%+2rem)] flex-col items-center justify-center gap-8 overflow-hidden text-center">
          <Particles tone="gold" count={56} />
          <div className="relative animate-rise">
            <p className="font-headline text-4xl text-[#ffe99a]">Top of the qualifying round</p>
            <p className="text-metal-gold mt-2 font-headline text-[8rem] leading-none">{champion.name}</p>
            <p className="mt-3 font-mono text-4xl text-[#ffe99a]">{champion.score} pts</p>
          </div>
          {runnersUp.length ? (
            <div className="relative flex flex-wrap justify-center gap-4">
              {runnersUp.map((r) => (
                <div key={r.team_id} className={cx(r.rank === 2 ? "card-metal-silver" : "card-metal-bronze", "min-w-72 rounded-2xl px-6 py-4 animate-pop")}>
                  <p className="font-mono text-xl">#{r.rank}</p>
                  <p className="font-headline text-4xl">{r.name}</p>
                  <p className="font-mono text-lg">{r.score} pts</p>
                </div>
              ))}
            </div>
          ) : null}
          <p className="relative font-headline text-3xl text-muted">Thanks for playing</p>
        </div>
      );
    }
  }
}
