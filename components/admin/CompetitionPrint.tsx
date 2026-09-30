"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { CompetitionDetail } from "@/lib/competition/types";
import {
  SCORING_MODE_LABEL,
  VERDICT_LABEL,
  acceptedText,
  answerText,
  clock,
  dateLong,
  firstCorrect,
  reviewSummary,
  markingNote,
  orderLabel,
  qualifiedSet,
  seconds,
  standings,
  teamSheet,
  tieBreakNote,
  timeline,
  verdict,
} from "@/lib/competition/format";

export type PrintKind = "qualified" | "full" | "team";

/**
 * Print-ready report on a white page. The browser's "Save as PDF" turns it
 * into a PDF, with Thai rendered correctly (the browser lays out the text).
 */
export function CompetitionPrint({ id, kind, teamId }: { id: string; kind: PrintKind; teamId?: string | null }) {
  const [d, setD] = useState<CompetitionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt] = useState(() => new Date());

  useEffect(() => {
    api<CompetitionDetail>(`/api/admin/competitions/${encodeURIComponent(id)}`).then(setD).catch((e) => setError((e as ApiError).message));
  }, [id]);

  useEffect(() => {
    if (d) document.title = `${kind === "qualified" ? "Qualified teams" : kind === "team" ? "Team answers" : "Competition report"} – ${d.competition.pack_title ?? d.competition.room_code}`;
  }, [d, kind]);

  if (error) return <div className="paper-page"><div className="paper"><p className="bad">{error}</p></div></div>;
  if (!d) return <div className="paper-page"><div className="paper"><p className="muted">Loading…</p></div></div>;

  const c = d.competition;
  const rows = standings(d);
  const q = qualifiedSet(d);
  const team = teamId ? c.teams.find((t) => t.team_id === teamId) : null;

  return (
    <div className="paper-page">
      <div className="paper">
        <div className="toolbar no-print">
          <button className="primary" onClick={() => window.print()}>🖨 Print / Save as PDF</button>
          <span className="muted small">In the print window, choose “Save as PDF” as the printer to get a PDF file.</span>
        </div>

        <header>
          <div className="muted small" style={{ letterSpacing: ".2em", textTransform: "uppercase", fontWeight: 700 }}>Samaggi University Challenge · Qualifying Round</div>
          <h1 style={{ marginTop: 6 }}>
            {kind === "qualified" ? "Qualified teams" : kind === "team" ? `Answer sheet: ${team?.name ?? "team"}` : "Competition report"}
          </h1>
          <div className="meta">
            <span><b>{c.pack_title ?? "—"}</b></span>
            <span>{dateLong(c.created_at)}, started {clock(c.created_at)}</span>
            <span>Room <span className="code">{c.room_code}</span></span>
            <span>{c.teams.length} teams · {c.questions_played} of {c.question_total} questions</span>
            <span>Scoring: {SCORING_MODE_LABEL[c.settings?.scoring_mode ?? "CLASSIC"]}</span>
          </div>
          <div className="meta small">
            <span>Printed {dateLong(printedAt.getTime())} {clock(printedAt.getTime())}</span>
            <span>Check code <b className="code">{d.fingerprint}</b></span>
            {c.status === "LIVE" ? <span className="bad">Game still running: this is not final</span> : <span>Final record{c.finished_at ? `, game ended ${clock(c.finished_at)}` : ""}</span>}
          </div>
        </header>

        {kind === "qualified" ? <Qualified d={d} /> : null}
        {kind === "team" && teamId ? <TeamAnswers d={d} teamId={teamId} /> : null}
        {kind === "full" ? (
          <>
            <h2>Final standings</h2>
            <StandingsTable d={d} />
            <h2 className="page-break">Questions</h2>
            <table>
              <thead>
                <tr><th className="num">#</th><th>Question</th><th>Accepted answers</th><th className="num">Correct</th><th>Timing</th></tr>
              </thead>
              <tbody>
                {d.questions.map((cq) => (
                  <tr key={cq.question_index}>
                    <td className="num">{cq.question_index + 1}</td>
                    <td className="q-text">{cq.question.question_text}</td>
                    <td>{acceptedText(cq.question)}</td>
                    <td className="num">{cq.stats ? `${cq.stats.correct}/${cq.stats.answered}` : "–"}</td>
                    <td className="small">
                      {clock(cq.started_at)}–{clock(cq.closed_at)} · {cq.effective.time_limit_sec}{"\u00a0"}s
                      {cq.closed_by === "HOST" ? " · locked early by host" : ""}
                      {cq.stats?.typo_accepted ? ` · ${cq.stats.typo_accepted} accepted with typos` : ""}
                      {cq.stats?.overrides?.length ? <div>Host review: {reviewSummary(cq.stats.overrides)}</div> : null}
                      {(() => {
                        const f = firstCorrect(cq);
                        return f ? <div>First correct: <b>{f.names.join(", ")}</b> ({seconds(f.elapsed_ms)})</div> : null;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h2>Anti-cheat and host actions</h2>
            <HostLog d={d} />
            <p className="muted small" style={{ marginTop: 18 }}>
              Every team's individual answers are in the Excel download, or print one team's answer sheet from the Competition log.
            </p>
          </>
        ) : null}

        {kind !== "team" ? (
          <div className="sign keep">
            <div>Checked by (name)</div>
            <div>Signature</div>
            <div>Date and time</div>
          </div>
        ) : null}
      </div>
    </div>
  );

  function Qualified({ d }: { d: CompetitionDetail }) {
    if (!c.qualification) {
      return (
        <>
          <p className="bad" style={{ marginTop: 16 }}>Qualification hasn't been revealed in this game yet. Current standings:</p>
          <StandingsTable d={d} />
        </>
      );
    }
    const through = rows.filter((r) => q.has(r.team_id));
    const tied = through.length > c.qualification.qualify_count;
    return (
      <>
        <p style={{ marginTop: 14 }}>
          Top <b>{c.qualification.qualify_count}</b> qualify.{tied ? ` ${through.length} teams go through because of a tie at the cut.` : ""}
        </p>
        <table>
          <thead>
            <tr><th className="num">Rank</th><th>Team</th><th className="num">Score</th><th className="num">Correct</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {through.map((r) => (
              <tr key={r.team_id}>
                <td className="num">{r.rank}</td>
                <td><b>{r.name}</b></td>
                <td className="num">{r.score}</td>
                <td className="num">{r.correct_count}</td>
                <td className="small">{tieBreakNote(rows, rows.indexOf(r)) ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > through.length ? (
          <p className="small muted" style={{ marginTop: 10 }}>
            Next placed (did not qualify): {rows.filter((r) => !q.has(r.team_id)).slice(0, 5).map((r) => `#${r.rank} ${r.name} (${r.score})`).join(", ")}
          </p>
        ) : null}
      </>
    );
  }

  function StandingsTable({ d }: { d: CompetitionDetail }) {
    const hasQ = !!d.competition.qualification;
    return (
      <table>
        <thead>
          <tr><th className="num">Rank</th><th>Team</th><th className="num">Score</th><th className="num">Correct</th><th className="num">Time on correct</th>{hasQ ? <th>Qualified</th> : null}<th>Notes</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const flags = d.competition.teams.find((t) => t.team_id === r.team_id)?.flags.length ?? 0;
            const cut = hasQ && q.has(r.team_id) && !q.has(rows[i + 1]?.team_id ?? "");
            return (
              <tr key={r.team_id} className={cut ? "cut" : undefined}>
                <td className="num">{r.rank}</td>
                <td>{r.name}</td>
                <td className="num">{r.score}</td>
                <td className="num">{r.correct_count}</td>
                <td className="num">{seconds(r.total_correct_time_ms)}</td>
                {hasQ ? <td className={q.has(r.team_id) ? "ok" : "muted"}>{q.has(r.team_id) ? "Yes" : "No"}</td> : null}
                <td className="small">{[flags ? `${flags} anti-cheat flag${flags > 1 ? "s" : ""}` : "", tieBreakNote(rows, i) ?? ""].filter(Boolean).join(" · ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
}

function HostLog({ d }: { d: CompetitionDetail }) {
  const items = timeline(d).filter((t) => t.warn || ["TIME_ADJUSTED", "ANSWERS_LOCKED_BY_HOST", "MARK_CHANGED", "QUALIFIED_TEAMS_SHOWN", "GAME_ENDED", "ROOM_DELETED"].includes(t.kind));
  if (!items.length) return <p className="muted">Nothing unusual: no anti-cheat flags, no time changes, no marking changes and no questions locked early.</p>;
  return (
    <table>
      <thead><tr><th>Time</th><th className="num">Q</th><th>Team</th><th>Event</th></tr></thead>
      <tbody>
        {items.map((t, i) => (
          <tr key={i}>
            <td className="num">{clock(t.at, true)}</td>
            <td className="num">{t.question_index !== null ? t.question_index + 1 : ""}</td>
            <td>{t.team ?? ""}</td>
            <td className={t.warn ? "bad" : undefined}>{t.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamAnswers({ d, teamId }: { d: CompetitionDetail; teamId: string }) {
  const lines = teamSheet(d, teamId);
  const row = standings(d).find((r) => r.team_id === teamId);
  return (
    <>
      {row ? <p style={{ marginTop: 12 }}>Rank <b>{row.rank}</b> · <b>{row.score}</b> points · {row.correct_count} correct</p> : null}
      <table>
        <thead>
          <tr><th className="num">Q</th><th>Question / accepted answers</th><th>Team's answer</th><th>Result and marking</th><th className="num">Sent</th><th className="num">Pts</th></tr>
        </thead>
        <tbody>
          {lines.map(({ q, a, order }) => (
            <tr key={q.question_index}>
              <td className="num">{q.question_index + 1}</td>
              <td>
                <div className="q-text">{q.question.question_text}</div>
                <div className="small ok">{acceptedText(q.question)}</div>
              </td>
              <td className="q-text">{a ? answerText(q.question, a) || "—" : "—"}</td>
              <td className="small">
                {a ? <b className={a.correct ? "ok" : verdict(a) === "PARTIAL" ? undefined : "bad"}>{VERDICT_LABEL[verdict(a)]}</b> : "Not recorded"}
                {a ? <div>{markingNote(q.question, a)}</div> : null}
              </td>
              <td className="num small">
                {a?.answered ? `${clock(a.received_at, true)} (+${seconds(a.elapsed_ms)})` : "–"}
                {order ? <div>{orderLabel(order)}</div> : null}
              </td>
              <td className="num">{a?.points ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
