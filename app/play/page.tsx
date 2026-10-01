"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError, loadSession, saveSession, type TeamSession } from "@/lib/client/api";
import { Button, ErrorNote, Field, Logo, inputClass } from "@/components/ui";

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase());
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<TeamSession | null>(null);
  const gone = params.get("gone");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveCode, setMoveCode] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);

  async function rejoin(e: React.FormEvent) {
    e.preventDefault();
    setMoveError(null);
    const c = code.trim().toUpperCase();
    if (c.length < 4) return setMoveError("Enter the room code from the big screen first.");
    if (moveCode.length !== 6) return setMoveError("The code from the host has 6 digits.");
    setMoveBusy(true);
    try {
      const s = await api<TeamSession>(`/api/rooms/${c}/rejoin`, { method: "POST", json: { transfer_code: moveCode } });
      saveSession(s);
      router.push(`/play/${c}`);
    } catch (err) {
      const ae = err as ApiError;
      setMoveError(ae.status === 404 ? "No room with that code. Check the big screen." : ae.message);
      setMoveBusy(false);
    }
  }

  useEffect(() => {
    const c = code.trim();
    setExisting(c.length >= 4 ? loadSession(c) : null);
  }, [code]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const c = code.trim().toUpperCase();
    if (c.length < 4) return setError("Enter the room code from the big screen.");
    if (name.trim().length < 2) return setError("Team name needs at least 2 characters.");
    setBusy(true);
    try {
      const s = await api<TeamSession>(`/api/rooms/${c}/join`, { method: "POST", json: { name } });
      saveSession(s);
      router.push(`/play/${c}`);
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.status === 404 ? "No room with that code. Check the big screen." : ae.message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Logo className="text-2xl" />
      <h1 className="mt-8 font-headline text-4xl font-bold">Join the quiz</h1>
      {gone ? (
        <p className="mt-4 rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm">
          {gone === "moved"
            ? "Your team is now playing on another device. This one has been signed out."
            : "The host removed this team from the game. If that's a mistake, speak to the host."}
        </p>
      ) : null}
      <form onSubmit={join} className="mt-8 space-y-5">
        <Field label="Room code">
          <input
            className={`${inputClass} h-16 text-center font-mono text-3xl font-bold uppercase tracking-[0.4em]`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            placeholder="ABCDE"
          />
        </Field>
        {existing ? (
          <div className="rounded-xl border border-gold/40 bg-gold/10 p-4">
            <p className="text-sm">
              You&apos;re already in this room as <b>{existing.name}</b>.
            </p>
            <Button type="button" className="mt-3 w-full" onClick={() => router.push(`/play/${existing.room_code}`)}>
              Continue as {existing.name}
            </Button>
          </div>
        ) : null}
        <Field label="Team name">
          <input
            className={`${inputClass} h-14 text-lg`}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 32))}
            maxLength={32}
            autoComplete="off"
            placeholder="e.g. Quizteama Aguilera"
          />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {existing ? "Join as a new team" : "Join"}
        </Button>
      </form>

      <div className="mt-8 border-t border-line pt-5">
        {!moveOpen ? (
          <button type="button" className="text-sm text-muted underline underline-offset-4 hover:text-white" onClick={() => setMoveOpen(true)}>
            Already playing, but your device stopped working? Use the code from the host
          </button>
        ) : (
          <form onSubmit={rejoin} className="space-y-3">
            <p className="text-sm text-muted">Ask the host to move your team to this device. They&apos;ll give you a 6-digit code. Your score is kept.</p>
            <Field label="Code from the host">
              <input
                className={`${inputClass} h-14 text-center font-mono text-2xl font-bold tracking-[0.4em]`}
                value={moveCode}
                onChange={(e) => setMoveCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </Field>
            <ErrorNote>{moveError}</ErrorNote>
            <Button type="submit" variant="secondary" className="w-full" loading={moveBusy}>
              Carry on as my team on this device
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function PlayJoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinForm />
    </Suspense>
  );
}
