"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button, ErrorNote, inputCls } from "@/components/ui";

/**
 * Host tools for one team, opened from the team list: fix the name, move the
 * team to a new device (one-time code), or take it out of the game.
 */
export function TeamActions({
  code, team, canRemove, onDone,
}: {
  code: string;
  team: { team_id: string; name: string };
  canRemove: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [move, setMove] = useState<{ code: string; expires_at: number } | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function act(action: "rename" | "move" | "remove") {
    setBusy(action);
    setError(null);
    try {
      const r = await api<{ transfer_code?: string; expires_at?: number }>(`/api/admin/rooms/${code}/teams`, {
        method: "POST",
        json: { team_id: team.team_id, action, ...(action === "rename" ? { name } : {}) },
      });
      if (action === "move" && r.transfer_code) setMove({ code: r.transfer_code, expires_at: r.expires_at ?? 0 });
      if (action === "remove") setConfirm(false);
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-line bg-ink/60 p-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act("rename");
        }}
      >
        <input className={inputCls("h-9 min-w-0 flex-1 text-sm")} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} aria-label="Team name" />
        <Button size="sm" variant="secondary" type="submit" loading={busy === "rename"} disabled={name.trim() === team.name}>
          Rename
        </Button>
      </form>

      <div>
        {move ? (
          <div className="rounded-lg border border-gold/50 bg-gold/10 p-3 text-center">
            <p className="text-xs text-muted">On the new device: open the join page, enter the room code, then “Use the code from the host”:</p>
            <p className="mt-1 font-mono text-4xl font-bold tracking-[0.3em] text-gold">{move.code}</p>
            <p className="text-xs text-muted">
              Works once, until {new Date(move.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. The old device is signed out when it&apos;s used.
            </p>
          </div>
        ) : (
          <Button size="sm" variant="secondary" className="w-full" loading={busy === "move"} onClick={() => act("move")}>
            📱 Move to a new device (keeps the score)
          </Button>
        )}
      </div>

      {canRemove ? (
        confirm ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Remove “{team.name}” from the game?</span>
            <Button size="sm" variant="danger" loading={busy === "remove"} onClick={() => act("remove")}>Yes, remove</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        ) : (
          <button type="button" className="text-xs text-bad hover:underline" onClick={() => setConfirm(true)}>
            Remove this team (test entry or duplicate)…
          </button>
        )
      ) : null}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
