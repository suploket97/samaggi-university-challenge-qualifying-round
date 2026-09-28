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
