"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { downloadCsv, downloadXlsx, fileSlug } from "@/lib/client/download";
import type { CompetitionDetail, CompetitionQuestion } from "@/lib/competition/types";
import {
  SCORING_MODE_LABEL,
  VERDICT_LABEL,
  acceptedText,
  answerRows,
  answerText,
  clock,
  dateLong,
  firstCorrect,
  markingNote,
  ordinal,
  orderLabel,
  qualifiedSet,
  questionRows,
  seconds,
  sendOrder,
  standings,
  standingsRows,
  teamById,
  teamSheet,
  tieBreakNote,
  timeline,
  timelineRows,
  verdict,
  type Verdict,
} from "@/lib/competition/format";
import { Button, Card, ErrorNote, Spinner, cx, inputCls } from "@/components/ui";
import { AdminShell } from "./AdminShell";
import { StatusBadge } from "./CompetitionList";

type Tab = "standings" | "teams" | "questions" | "timeline";

const VERDICT_STYLE: Record<Verdict, string> = {
  CORRECT: "bg-good/15 text-good",
  PARTIAL: "bg-sky/15 text-sky",
  WRONG: "bg-bad/15 text-bad",
  NO_ANSWER: "bg-white/10 text-muted",
  LOCKED_OUT: "bg-bad/25 text-bad",
};

export function VerdictChip({ v }: { v: Verdict }) {
  return <span className={cx("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", VERDICT_STYLE[v])}>{VERDICT_LABEL[v]}</span>;
}

/** Loads the log and, while the game is live, checks every 5 s for anything new. */
function useCompetition(id: string) {
  const [data, setData] = useState<CompetitionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const v = version.current ? `?v=${encodeURIComponent(version.current)}` : "";
      const r = await api<CompetitionDetail | { unchanged: true }>(`/api/admin/competitions/${encodeURIComponent(id)}${v}`);
      if ("unchanged" in r) return;
      version.current = r.competition.updated_at;
      setData(r);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  const live = data?.competition.status === "LIVE";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [live, load]);
  return { data, error };
}

export function CompetitionView({ id }: { id: string }) {
  const router = useRouter();
  const { data, error } = useCompetition(id);
  const [tab, setTab] = useState<Tab>("standings");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error && !data) {
    return (
      <AdminShell title="Competition log">
        <ErrorNote>{error}</ErrorNote>
        <Link href="/admin/competitions" className="mt-4 inline-block text-sm text-muted hover:text-white">← All competitions</Link>
      </AdminShell>
    );
  }
  if (!data) {
    return (
      <AdminShell title="Competition log">
        <div className="grid place-items-center py-20"><Spinner /></div>
      </AdminShell>
    );
  }

  const c = data.competition;
  const name = `${fileSlug(c.pack_title ?? "competition")}-${c.room_code}-${new Date(c.created_at).toISOString().slice(0, 10)}`;

  async function exportExcel() {
    setExporting("xlsx");
    setActionError(null);
    try {
      await downloadXlsx(`${name}.xlsx`, [
        { name: "Standings", rows: standingsRows(data!), widths: [6, 28, 8, 10, 14, 10, 10, 60] },
        { name: "Answers", rows: answerRows(data!), widths: [9, 50, 24, 30, 14, 70, 7, 7, 14, 10, 24] },
        { name: "Questions", rows: questionRows(data!), widths: [9, 18, 60, 40, 8, 7, 10, 10, 12, 10, 9, 8, 9, 10, 9, 50] },
        { name: "Timeline", rows: timelineRows(data!), widths: [14, 9, 24, 70] },
      ]);
    } catch (e) {
      setActionError(`Couldn't make the Excel file: ${(e as Error).message}`);
    } finally {
      setExporting(null);
    }
  }

  async function remove() {
    setActionError(null);
    try {
      await api(`/api/admin/competitions/${encodeURIComponent(c.competition_id)}`, { method: "DELETE" });
      router.push("/admin/competitions");
    } catch (e) {
      setActionError((e as ApiError).message);
    }
  }

  const printHref = (kind: string) => `/admin/competitions/${encodeURIComponent(c.competition_id)}/print?kind=${kind}`;

  return (
    <AdminShell
      title={c.pack_title ?? "Competition"}
      actions={
        <>
          <a href={printHref("qualified")} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary">🖨 Qualified list</Button></a>
          <a href={printHref("full")} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary">🖨 Full report</Button></a>
          <Button size="sm" variant="secondary" loading={exporting === "xlsx"} onClick={exportExcel}>⬇ Excel</Button>
          <Button size="sm" variant="ghost" onClick={() => downloadCsv(`${name}-answers.csv`, answerRows(data))}>⬇ CSV</Button>
        </>
      }
    >
      <Link href="/admin/competitions" className="mb-3 inline-block text-sm text-muted hover:text-white">← All competitions</Link>

      <Card className="mb-5 flex flex-wrap items-center gap-x-8 gap-y-3 p-4 text-sm">
        <StatusBadge status={c.status} />
        <Info k="Date" v={`${dateLong(c.created_at)} · ${clock(c.created_at)}`} />
        <Info k="Room" v={<span className="font-mono tracking-widest">{c.room_code}</span>} />
        <Info k="Teams" v={<span className="font-mono">{c.teams.length}</span>} />
        <Info k="Questions played" v={<span className="font-mono">{c.questions_played} / {c.question_total}</span>} />
        <Info k="Scoring" v={SCORING_MODE_LABEL[c.settings?.scoring_mode ?? "CLASSIC"]} />
        {c.qualification ? <Info k="Qualified" v={<span className="font-mono">{c.qualification.qualified_team_ids.length} (top {c.qualification.qualify_count})</span>} /> : null}
        <Info
          k="Check code"
          v={<span className="font-mono tracking-wider" title="Printed on reports. Export again later and compare: the same code means the record hasn't changed.">{data.fingerprint}</span>}
        />
        {c.status === "LIVE" ? <span className="text-xs text-muted">Updates every few seconds while the game runs.</span> : null}
      </Card>

      {actionError ? <div className="mb-4"><ErrorNote>{actionError}</ErrorNote></div> : null}

      <div role="tablist" className="mb-5 flex flex-wrap gap-2">
        {([
          ["standings", "Standings"],
          ["teams", "Teams' answers"],
          ["questions", "Questions"],
          ["timeline", "Timeline"],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx("h-10 rounded-xl border px-4 text-sm font-semibold transition", tab === t ? "border-gold bg-gold text-ink" : "border-line text-muted hover:text-white")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "standings" ? <StandingsTab d={data} onTeam={(t) => { setTeamId(t); setTab("teams"); }} /> : null}
      {tab === "teams" ? <TeamsTab d={data} teamId={teamId} setTeamId={setTeamId} /> : null}
      {tab === "questions" ? <QuestionsTab d={data} /> : null}
      {tab === "timeline" ? <TimelineTab d={data} /> : null}

      <div className="mt-10 border-t border-line pt-5">
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Delete this record for good?{c.status === "LIVE" ? " The game is still running: new answers would start a fresh, incomplete record." : ""}
            </span>
            <Button size="sm" variant="danger" onClick={remove}>Yes, delete it</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}><span className="text-bad">Delete this record…</span></Button>
        )}
      </div>
    </AdminShell>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{k}</div>
      <div className="font-semibold">{v}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StandingsTab({ d, onTeam }: { d: CompetitionDetail; onTeam: (id: string) => void }) {
  const rows = standings(d);
  const q = qualifiedSet(d);
  const teams = teamById(d);
  const hasQual = !!d.competition.qualification;
  if (!rows.length) return <Card className="p-8 text-center text-muted">No scores yet. Standings appear after the first answer is revealed.</Card>;
  return (
    <Card className="overflow-x-auto">
      {!hasQual ? <p className="border-b border-line px-4 py-3 text-xs text-muted">Standings after the latest revealed question. Qualification hasn't been revealed yet.</p> : null}
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-muted">
          <tr className="border-b border-line">
            <th className="px-4 py-3 font-medium">Rank</th>
            <th className="px-4 py-3 font-medium">Team</th>
            <th className="px-4 py-3 text-right font-medium">Score</th>
            <th className="px-4 py-3 text-right font-medium">Correct</th>
            <th className="px-4 py-3 text-right font-medium">Time on correct</th>
            <th className="px-4 py-3 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isQ = q.has(r.team_id);
            const cutAfter = hasQual && isQ && !q.has(rows[i + 1]?.team_id ?? "");
            const flags = teams.get(r.team_id)?.flags.length ?? 0;
            const tie = tieBreakNote(rows, i);
            return (
              <tr
                key={r.team_id}
                className="border-b border-line/60 last:border-0"
                // Gold line under the last qualifying team (inline, so it can't lose to the default border colour).
                style={cutAfter ? { borderBottom: "2px solid var(--color-gold)" } : undefined}
              >
                <td className="px-4 py-2.5 font-mono text-base tabular">{r.rank}</td>
                <td className="px-4 py-2.5">
                  <button className="text-left font-semibold hover:text-gold" onClick={() => onTeam(r.team_id)}>{r.name}</button>
                  {hasQual ? <span className={cx("ml-2 text-xs font-semibold", isQ ? "text-good" : "text-muted")}>{isQ ? "Qualified" : ""}</span> : null}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-base tabular">{r.score}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular">{r.correct_count}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular">{seconds(r.total_correct_time_ms)}</td>
                <td className="px-4 py-2.5 text-xs text-muted">
                  {flags ? <span className="mr-3 text-bad">⚠ {flags} anti-cheat flag{flags > 1 ? "s" : ""}</span> : null}
                  {tie}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasQual ? <p className="px-4 py-3 text-xs text-muted">The gold line is the qualification cut. Teams tied with the last qualifying place also qualify. Ties are broken by correct answers, then total time on correct answers.</p> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function TeamsTab({ d, teamId, setTeamId }: { d: CompetitionDetail; teamId: string | null; setTeamId: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "notright" | "flags">("all");
  const sheetRef = useRef<HTMLDivElement | null>(null);
  function pick(id: string) {
    setTeamId(id);
    // On a phone the list sits above the answer sheet: jump down to it.
    if (window.innerWidth < 1024) requestAnimationFrame(() => sheetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  const rows = standings(d);
  const rankOf = new Map(rows.map((r) => [r.team_id, r]));
  const teams = [...d.competition.teams].sort((a, b) => (rankOf.get(a.team_id)?.rank ?? 1e9) - (rankOf.get(b.team_id)?.rank ?? 1e9));
  const shown = teams.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));
  const current = teamId ?? shown[0]?.team_id ?? null;
  const sheet = useMemo(() => (current ? teamSheet(d, current) : []), [d, current]);
  const team = teams.find((t) => t.team_id === current);
  const lines = sheet.filter(({ a }) => {
    if (filter === "all") return true;
    if (filter === "flags") return !!a && (a.flags.length > 0 || a.voided);
    return !a || !a.correct;
  });

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="p-3 lg:sticky lg:top-4">
        <input className={inputCls("h-10 text-sm")} placeholder="Search team name…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search teams" />
        <ul className="mt-2 max-h-[60vh] overflow-y-auto">
          {shown.map((t) => {
            const r = rankOf.get(t.team_id);
            return (
              <li key={t.team_id}>
                <button
                  onClick={() => pick(t.team_id)}
                  className={cx("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm", current === t.team_id ? "bg-gold/15 text-white" : "text-muted hover:bg-white/5 hover:text-white")}
                >
                  <span className="w-7 font-mono text-xs tabular">{r ? `#${r.rank}` : "–"}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                  {t.flags.length ? <span className="text-xs text-bad" title="Anti-cheat flags">⚠{t.flags.length}</span> : null}
                  <span className="font-mono text-xs tabular">{r?.score ?? 0}</span>
                </button>
              </li>
            );
          })}
          {!shown.length ? <li className="px-2 py-3 text-sm text-muted">No team matches.</li> : null}
        </ul>
      </Card>

      <div ref={sheetRef} className="scroll-mt-4">
        {team ? (
          <>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-headline text-3xl">{team.name}</h2>
              <a
                href={`/admin/competitions/${encodeURIComponent(d.competition.competition_id)}/print?kind=team&team=${encodeURIComponent(team.team_id)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-white"
              >
                🖨 Print this team&apos;s answers
              </a>
              <span className="w-full text-sm text-muted">
                Joined {clock(team.joined_at)}
                {rankOf.get(team.team_id) ? ` · #${rankOf.get(team.team_id)!.rank} · ${rankOf.get(team.team_id)!.score} pts` : ""}
              </span>
            </div>
            <div className="mb-4 flex flex-wrap gap-2 text-sm">
              {([["all", "All questions"], ["notright", "Not fully right"], ["flags", "Anti-cheat"]] as const).map(([f, label]) => (
                <button key={f} onClick={() => setFilter(f)} className={cx("h-8 rounded-lg border px-3", filter === f ? "border-gold text-gold" : "border-line text-muted hover:text-white")}>
                  {label}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {lines.map(({ q, a, order }) => (
                <Card key={q.question_index} className="p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="font-mono font-bold text-gold">Q{q.question_index + 1}</span>
                    {a ? <VerdictChip v={verdict(a)} /> : <span>Not recorded for this team (joined later?)</span>}
                    {a?.answered ? (
                      <span className="tabular">
                        Sent {clock(a.received_at, true)} · {seconds(a.elapsed_ms)} after the question opened
                        {order ? <> · <b className="text-white">{orderLabel(order)}</b> to answer</> : null}
                      </span>
                    ) : null}
                    {a ? <span className="ml-auto font-mono text-sm text-white tabular">{a.points} pts{a.speed_bonus ? ` (incl. +${a.speed_bonus} speed)` : ""}</span> : null}
                  </div>
                  <p className="line-clamp-2 whitespace-pre-line text-sm text-muted">{q.question.question_text}</p>
                  {a?.answered ? <p className="mt-2 whitespace-pre-line break-words font-display text-lg font-semibold">{answerText(q.question, a)}</p> : null}
                  {a ? <p className="mt-1 text-sm text-muted">{markingNote(q.question, a)}</p> : null}
                  {a && (!a.correct || a.voided) ? <p className="mt-1 text-xs text-muted">Accepted: <span className="text-good">{acceptedText(q.question)}</span></p> : null}
                  {a?.flags.length ? (
                    <p className="mt-1 text-xs text-bad">
                      ⚠ {a.flags.map((f) => (f.kind === "PASTE_ATTEMPT" ? `tried to paste at ${clock(f.at)}` : f.kind === "WINDOW_BLUR" ? `another window in front for ${seconds(f.duration_ms ?? 0)} (flag only)` : `left the screen for ${seconds(f.duration_ms ?? 0)} at ${clock(f.at)}`)).join("; ")}
                    </p>
                  ) : null}
                </Card>
              ))}
              {!lines.length ? <Card className="p-6 text-center text-sm text-muted">Nothing to show with this filter.</Card> : null}
            </div>
          </>
        ) : (
          <Card className="p-8 text-center text-muted">No teams yet.</Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuestionsTab({ d }: { d: CompetitionDetail }) {
  if (!d.questions.length) return <Card className="p-8 text-center text-muted">No questions played yet.</Card>;
  return (
    <div className="space-y-3">
      {d.questions.map((q) => <QuestionCard key={q.question_index} q={q} />)}
    </div>
  );
}

const ORDER: Verdict[] = ["CORRECT", "PARTIAL", "WRONG", "LOCKED_OUT", "NO_ANSWER"];

function QuestionCard({ q }: { q: CompetitionQuestion }) {
  const [sortBy, setSortBy] = useState<"result" | "order">("result");
  const s = q.stats;
  const pct = s && s.answered ? Math.round((s.correct / s.answered) * 100) : null;
  const order = sendOrder(q);
  const first = firstCorrect(q);
  const byTime = (a: { received_at: number | null }, b: { received_at: number | null }) => (a.received_at ?? 1e15) - (b.received_at ?? 1e15);
  const results = [...(q.results ?? [])].sort((a, b) =>
    sortBy === "order" ? byTime(a, b) || ORDER.indexOf(verdict(a)) - ORDER.indexOf(verdict(b)) : ORDER.indexOf(verdict(a)) - ORDER.indexOf(verdict(b)) || byTime(a, b),
  );
  return (
    <Card className="p-0">
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-3">
          <span className="font-mono font-bold text-gold">Q{q.question_index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{q.question.question_text}</span>
          {q.revealed_at ? (
            <span className="flex items-center gap-2 text-xs text-muted tabular">
              <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-white/10 sm:block">
                <span className="block h-full bg-good" style={{ width: `${pct ?? 0}%` }} />
              </span>
              {s?.correct}/{s?.answered} correct
            </span>
          ) : (
            <span className="text-xs text-gold">Not revealed yet</span>
          )}
        </summary>
        <div className="border-t border-line px-4 py-4 text-sm">
          <p className="whitespace-pre-line break-words font-display text-base">{q.question.question_text}</p>
          {q.question.sub_questions?.length ? (
            <ol className="mt-2 list-decimal pl-5 text-muted">
              {q.question.sub_questions.map((sq) => <li key={sq.sub_id} className="whitespace-pre-line">{sq.prompt}</li>)}
            </ol>
          ) : null}
          {q.question.type === "ORDERING" || q.question.type === "MATCHING" ? (
            q.effective.shown_order ? (
              <p className="mt-2 text-muted">Phones showed: {q.effective.shown_order.join("   ")}</p>
            ) : null
          ) : q.question.choices?.length ? (
            <p className="mt-2 text-muted">{q.question.choices.map((c) => `${c.choice_id}) ${c.text || "(picture)"}`).join("   ")}</p>
          ) : null}
          <p className="mt-3"><span className="text-muted">Accepted: </span><span className="text-good">{acceptedText(q.question)}</span></p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted tabular">
            <span>Opened {clock(q.started_at)}</span>
            <span>{q.effective.time_limit_sec} s{q.effective.time_override ? " (set by host)" : ""}</span>
            <span>Closed {clock(q.closed_at)}{q.closed_by === "HOST" ? " by the host (early)" : q.closed_by === "TIMER" ? " when time ran out" : ""}</span>
            <span>Revealed {clock(q.revealed_at)}</span>
            <span>{q.effective.base_points} pts</span>
          </div>
          {s ? (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <span className="text-good">{s.correct} correct</span>
              {s.partial ? <span className="text-sky">{s.partial} partly right</span> : null}
              <span className="text-bad">{s.wrong} wrong</span>
              <span className="text-muted">{s.no_answer} no answer</span>
              {s.voided ? <span className="text-bad">{s.voided} locked out</span> : null}
              {s.typo_accepted ? <span className="text-muted">{s.typo_accepted} accepted with typos</span> : null}
              {s.avg_correct_ms !== null ? <span className="text-muted">avg {seconds(s.avg_correct_ms)} to answer correctly</span> : null}
            </div>
          ) : null}
          {first ? (
            <p className="mt-2 text-xs">
              <span className="text-muted">First correct answer: </span>
              <b className="text-gold">{first.names.join(", ")}</b>
              <span className="text-muted"> after {seconds(first.elapsed_ms)}</span>
            </p>
          ) : null}
          {s?.overrides?.length ? (
            <div className="mt-3 rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-xs">
              <p className="font-semibold text-gold">Host review before the reveal: {s.overrides.length} marking change{s.overrides.length === 1 ? "" : "s"}</p>
              <ul className="mt-1 space-y-0.5">
                {s.overrides.map((o) => (
                  <li key={o.key}>
                    {o.part !== null ? <span className="text-muted">Part {o.part + 1}: </span> : null}
                    <b>{o.label}</b> →{" "}
                    <span className={o.verdict === "CORRECT" ? "text-good" : "text-bad"}>{o.verdict === "CORRECT" ? "correct" : "wrong"}</span>
                    <span className="text-muted"> (automatic: {o.auto === "CORRECT" ? "correct" : "wrong"}, changed at {clock(o.at, true)})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {s?.wrong_answers.length ? (
            <p className="mt-2 text-xs text-muted">
              Common wrong answers: {s.wrong_answers.slice(0, 8).map((w) => `${w.answer} (${w.count})`).join(" · ")}
            </p>
          ) : null}
          {results.length ? (
            <div className="mt-4 flex items-center gap-2 text-xs">
              <span className="text-muted">Sort by</span>
              {([["result", "Result"], ["order", "Order sent"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSortBy(k)}
                  className={cx("h-7 rounded-lg border px-2.5", sortBy === k ? "border-gold text-gold" : "border-line text-muted hover:text-white")}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {results.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-left text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-3 font-medium">Team</th>
                    <th className="py-2 pr-3 font-medium">Answer</th>
                    <th className="py-2 pr-3 font-medium">Result</th>
                    <th className="py-2 pr-3 font-medium">How it was marked</th>
                    <th className="py-2 pr-3 text-right font-medium">Time</th>
                    <th className="py-2 pr-3 text-right font-medium">Order</th>
                    <th className="py-2 text-right font-medium">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((a) => (
                    <tr key={a.team_id} className="border-b border-line/50 align-top last:border-0">
                      <td className="py-2 pr-3 font-semibold">{a.team_name}</td>
                      <td className="max-w-64 break-words py-2 pr-3">{answerText(q.question, a) || <span className="text-muted">—</span>}</td>
                      <td className="py-2 pr-3"><VerdictChip v={verdict(a)} /></td>
                      <td className="py-2 pr-3 text-muted">{markingNote(q.question, a)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-mono tabular">{a.answered ? seconds(a.elapsed_ms) : "–"}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-mono tabular" title={orderLabel(order.get(a.team_id))}>
                        {order.get(a.team_id) ? ordinal(order.get(a.team_id)!.pos) : "–"}
                      </td>
                      <td className="py-2 text-right font-mono tabular">{a.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function TimelineTab({ d }: { d: CompetitionDetail }) {
  const [onlyFlags, setOnlyFlags] = useState(false);
  const items = timeline(d).filter((t) => !onlyFlags || t.warn);
  return (
    <Card className="p-4">
      <label className="mb-3 flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={onlyFlags} onChange={(e) => setOnlyFlags(e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
        Only anti-cheat events
      </label>
      <ol className="text-sm">
        {items.map((t, i) => (
          <li key={i} className="grid grid-cols-[92px_48px_minmax(0,1fr)] gap-3 border-b border-line/50 py-2 last:border-0">
            <span className="font-mono text-xs text-muted tabular">{clock(t.at, true)}</span>
            <span className="font-mono text-xs text-gold">{t.question_index !== null ? `Q${t.question_index + 1}` : ""}</span>
            <span className={cx(t.warn && "text-bad")}>
              {t.team ? <b className="mr-1.5 text-white">{t.team}</b> : null}
              {t.text}
            </span>
          </li>
        ))}
        {!items.length ? <li className="py-4 text-center text-muted">Nothing recorded.</li> : null}
      </ol>
    </Card>
  );
}
