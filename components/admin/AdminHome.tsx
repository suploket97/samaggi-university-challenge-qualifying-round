"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { usePoll } from "@/lib/client/hooks";
import { Button, Card, ErrorNote, Field, Spinner, cx, inputClass } from "@/components/ui";
import type { ScoringMode } from "@/lib/game/types";
import { AdminShell } from "./AdminShell";
import { PasswordCard } from "./PasswordCard";

interface Health {
  missing: string[];
  checks: { name: string; ok: boolean; detail?: string }[];
  all_ok: boolean;
}
interface RoomRow {
  room_code: string;
  phase: string;
  created_at: number;
  quiz_pack_id: string | null;
}

const SCORING_CHOICES: { value: ScoringMode; title: string; detail: string }[] = [
  { value: "CLASSIC", title: "Classic (points + speed bonus)", detail: "Full points for a right answer, plus a speed bonus (normally +20 within 5 s, +10 within 10 s)." },
  { value: "ACCURACY", title: "Accuracy only", detail: "Full points for a right answer whenever it arrives before time is up. No speed bonus." },
  { value: "DECAY", title: "Speed decay", detail: "Points shrink steadily: 100% for an instant answer down to 50% at the buzzer." },
];

export function AdminHome() {
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const { data, reload } = usePoll<{ rooms: RoomRow[] }>("/api/admin/rooms", 10000);
  const [policy, setPolicy] = useState("VOID_CURRENT_ANSWER");
  const [focusSec, setFocusSec] = useState(3);
  const [maxTeams, setMaxTeams] = useState(200);
  const [scoring, setScoring] = useState<ScoringMode>("CLASSIC");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Health>("/api/admin/health").then(setHealth).catch((e) => setError((e as Error).message));
  }, []);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const r = await api<{ room_code: string }>("/api/admin/rooms", {
        method: "POST",
        json: { anti_cheat_policy: policy, focus_violation_sec: focusSec, max_teams: maxTeams, scoring_mode: scoring },
      });
      router.push(`/admin/room/${r.room_code}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  return (
    <AdminShell title="Host console">
      {health && !health.all_ok ? (
        <Card className="mb-6 border-bad/50 p-5">
          <h2 className="font-headline text-2xl text-bad">Setup needs attention</h2>
          {health.missing.length ? (
            <div className="mt-3">
              <p className="text-sm text-muted">Missing environment variables (Vercel → Project → Settings → Environment Variables, then redeploy):</p>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {health.missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          ) : null}
          <ul className="mt-3 space-y-1 text-sm">
            {health.checks.map((c) => (
              <li key={c.name}>
                {c.ok ? "✅" : "❌"} {c.name}
                {c.detail ? <span className="text-muted"> — {c.detail}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-6">
        <Card className="p-5">
          <h2 className="font-headline text-xl font-bold">New room</h2>
          <div className="mt-4 space-y-4">
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">Scoring</legend>
              <div className="space-y-2">
                {SCORING_CHOICES.map((o) => (
                  <label
                    key={o.value}
                    className={cx(
                      "flex cursor-pointer gap-3 rounded-xl border p-3",
                      scoring === o.value ? "border-gold bg-gold/10" : "border-line hover:border-muted",
                    )}
                  >
                    <input type="radio" name="scoring" className="mt-1 accent-gold" checked={scoring === o.value} onChange={() => setScoring(o.value)} />
                    <span>
                      <span className="block font-semibold">{o.title}</span>
                      <span className="block text-xs text-muted">{o.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">Fixed for the whole game once the room is created. Equal scores are still split by total time on correct answers.</p>
            </fieldset>
            <Field label="If a player leaves the quiz screen" hint="Page Visibility tracking while a question is open.">
              <select className={inputClass} value={policy} onChange={(e) => setPolicy(e.target.value)}>
                <option value="VOID_CURRENT_ANSWER">Void their answer for that question</option>
                <option value="FLAG_ONLY">Flag it for me only</option>
              </select>
            </Field>
            <Field label="Allowed time away (seconds)">
              <input type="number" min={1} max={60} className={inputClass} value={focusSec} onChange={(e) => setFocusSec(Number(e.target.value))} />
            </Field>
            <Field label="Max teams">
              <input type="number" min={1} max={1000} className={inputClass} value={maxTeams} onChange={(e) => setMaxTeams(Number(e.target.value))} />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <Button className="w-full" onClick={create} loading={creating}>Create room</Button>
          </div>
        </Card>

        <PasswordCard />
        </div>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-headline text-xl font-bold">Rooms</h2>
            <Link href="/admin/bank" className="text-sm text-gold hover:underline">Manage question packs →</Link>
          </div>
          {!data ? (
            <div className="mt-6 text-muted"><Spinner /></div>
          ) : data.rooms.length === 0 ? (
            <p className="mt-6 text-muted">No rooms yet. Rooms expire 12 hours after their last change.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {data.rooms.map((r) => (
                <li key={r.room_code} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="font-mono text-2xl font-bold tracking-widest">{r.room_code}</span>
                  <PhaseBadge phase={r.phase} />
                  <span className="text-sm text-muted">{r.quiz_pack_id ?? "no pack yet"} · {new Date(r.created_at).toLocaleString()}</span>
                  <span className="ml-auto flex gap-2">
                    <Link href={`/admin/room/${r.room_code}`}><Button size="sm">Control</Button></Link>
                    <a href={`/stage/${r.room_code}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary">Stage ↗</Button></a>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!confirm(`Delete room ${r.room_code}? Players will be disconnected.`)) return;
                        await api(`/api/admin/rooms/${r.room_code}`, { method: "DELETE" }).catch(() => {});
                        reload();
                      }}
                    >
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}

export function PhaseBadge({ phase }: { phase: string }) {
  const color: Record<string, string> = {
    WAITING: "bg-sky/20 text-sky",
    PLAYING: "bg-good/20 text-good",
    SUBMITTED_WAITING: "bg-sky/20 text-sky",
    REVEAL_ANSWER: "bg-gold/20 text-gold",
    LEADERBOARD: "bg-violet/20 text-violet",
    TIE_BREAK: "bg-gold/20 text-gold",
    QUALIFICATION_REVEAL: "bg-violet/20 text-violet",
    ENDED: "bg-white/10 text-muted",
  };
  return <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-bold", color[phase] ?? "bg-white/10")}>{phase.replace(/_/g, " ")}</span>;
}
