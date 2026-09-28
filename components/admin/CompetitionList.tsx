"use client";
import Link from "next/link";
import { usePoll } from "@/lib/client/hooks";
import type { CompetitionSummary } from "@/lib/competition/types";
import { clock, dateLong } from "@/lib/competition/format";
import { Card, ErrorNote, Spinner } from "@/components/ui";
import { AdminShell } from "./AdminShell";

export function StatusBadge({ status }: { status: "LIVE" | "FINISHED" }) {
  return status === "LIVE" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-good/15 px-2.5 py-0.5 text-xs font-semibold text-good">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" /> Live
    </span>
  ) : (
    <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-muted">Finished</span>
  );
}

export function CompetitionList() {
  const { data, error } = usePoll<{ competitions: CompetitionSummary[] }>("/api/admin/competitions", 10000);
  const list = data?.competitions ?? null;

  return (
    <AdminShell title="Competition log">
      <p className="mb-5 max-w-3xl text-sm text-muted">
        Every game is recorded automatically as it's played: each team's answer exactly as typed, when it arrived, how it was marked,
        anti-cheat flags and every host action. Records are read-only and stay until you delete them. Use them to settle challenges and to
        print or download the results.
      </p>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {!list && !error ? (
        <div className="grid place-items-center py-16"><Spinner /></div>
      ) : list && list.length === 0 ? (
        <Card className="p-8 text-center text-muted">
          No competitions yet. The log starts as soon as a room loads a question pack.
        </Card>
      ) : list ? (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Question pack</th>
                <th className="px-4 py-3 font-medium">Room</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Teams</th>
                <th className="px-4 py-3 text-right font-medium">Questions</th>
                <th className="px-4 py-3 font-medium">Leader / qualified</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.competition_id} className="border-b border-line/60 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link href={`/admin/competitions/${encodeURIComponent(c.competition_id)}`} className="font-semibold text-white hover:text-gold">
                      {dateLong(c.created_at)}
                    </Link>
                    <span className="block text-xs text-muted tabular">{clock(c.created_at)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/competitions/${encodeURIComponent(c.competition_id)}`} className="hover:text-gold">
                      {c.pack_title ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono tracking-widest">{c.room_code}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-right font-mono tabular">{c.team_count}</td>
                  <td className="px-4 py-3 text-right font-mono tabular">{c.questions_played} / {c.question_total}</td>
                  <td className="px-4 py-3">
                    {c.leader ?? "—"}
                    {c.qualified_count !== null ? <span className="block text-xs text-muted">{c.qualified_count} qualified</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </AdminShell>
  );
}
