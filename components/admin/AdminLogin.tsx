"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, ErrorNote, Field, Logo, Spinner, inputClass } from "@/components/ui";
import { APP_VERSION } from "@/lib/version";

type Mode = "unset" | "stored" | "env";

/** First visit: create the host password. Afterwards: log in. */
export function AdminLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [setupProblem, setSetupProblem] = useState<{ message: string; found: string[] } | null>(null);

  useEffect(() => {
    api<{ mode: Mode }>("/api/admin/auth")
      .then((r) => setMode(r.mode))
      .catch((e) => {
        const ae = e as ApiError;
        if (ae.code === "CONFIG") {
          const body = (ae.body ?? {}) as { found?: string[] };
          setSetupProblem({ message: ae.message, found: body.found ?? [] });
        } else {
          setError("Couldn't reach the server. Try reloading the page.");
        }
      });
  }, []);

  if (setupProblem) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5">
        <Logo className="text-2xl" />
        <h1 className="mt-8 font-headline text-4xl text-bad">Setup isn&apos;t finished</h1>
        <p className="mt-1 text-xs text-muted/70 tabular">Version {APP_VERSION}</p>
        <p className="mt-4 leading-relaxed">{setupProblem.message}.</p>
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>In Vercel, open <b className="text-white">this</b> project (each Vercel Drop upload creates a new project).</li>
          <li>Go to the <b className="text-white">Storage</b> tab and connect both Supabase and Upstash for Redis to it.</li>
          <li>Go to <b className="text-white">Deployments</b> → ⋯ → <b className="text-white">Redeploy</b>, wait for it to finish, then reload this page.</li>
        </ol>
        <div className="mt-6 rounded-xl border border-line bg-panel p-4 text-sm">
          <p className="font-semibold">Database settings this project has right now:</p>
          {setupProblem.found.length ? (
            <ul className="mt-2 space-y-0.5 font-mono text-xs text-muted">
              {setupProblem.found.map((n) => <li key={n}>{n}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-muted">None: no database is connected to this project yet.</p>
          )}
        </div>
        <Button className="mt-6" variant="secondary" onClick={() => window.location.reload()}>Check again</Button>
      </main>
    );
  }

  const creating = mode === "unset";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (creating) {
      if (password.length < 8) return setError("Use at least 8 characters.");
      if (password !== confirm) return setError("The two passwords don't match.");
    }
    setBusy(true);
    try {
      await api(creating ? "/api/admin/setup" : "/api/admin/login", { method: "POST", json: { password } });
      router.refresh();
    } catch (err) {
      const ae = err as ApiError;
      if (ae.code === "NO_PASSWORD") setMode("unset");
      else if (ae.code === "ALREADY_SET") setMode("stored");
      setError(ae.message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <Logo className="text-2xl" />
      <h1 className="mt-8 font-headline text-4xl">{creating ? "Create the host password" : "Host login"}</h1>
      {mode === null && !error ? (
        <Spinner className="mt-6 text-muted" />
      ) : (
        <form className="mt-6 space-y-4" onSubmit={submit}>
          {creating ? (
            <p className="text-sm text-muted">
              This is the first visit, so choose the password for the host console. Anyone with it can run games and edit
              question packs. Use at least 8 characters; a short phrase is easiest to remember.
            </p>
          ) : null}
          <Field label={creating ? "New password" : "Password"}>
            <input
              type={show ? "text" : "password"}
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={creating ? "new-password" : "current-password"}
              autoFocus
            />
          </Field>
          {creating ? (
            <Field label="Type it again">
              <input type={show ? "text" : "password"} className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
            Show password
          </label>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" className="w-full" loading={busy} disabled={mode === null}>
            {creating ? "Create password and continue" : "Log in"}
          </Button>
          {!creating && mode ? (
            <p className="text-xs text-muted">
              Forgot it? See “Forgot the host password” in the README. You&apos;ll need access to the Vercel project.
            </p>
          ) : null}
        </form>
      )}
      <p className="mt-10 text-xs text-muted/70 tabular">Version {APP_VERSION}</p>
    </main>
  );
}
