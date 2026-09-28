"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, ErrorNote, Field, inputClass } from "@/components/ui";

/** Change the host password (current password required). Other devices are signed out. */
export function PasswordCard() {
  const [mode, setMode] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ mode: string }>("/api/admin/auth").then((r) => setMode(r.mode)).catch(() => {});
  }, []);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-headline text-2xl">Host password</h2>
        {mode === "stored" && !open ? (
          <Button size="sm" variant="secondary" onClick={() => { setOpen(true); setDone(false); }}>Change password</Button>
        ) : null}
      </div>
      {mode === "env" ? (
        <p className="mt-2 text-sm text-muted">Set by the ADMIN_PASSWORD variable in Vercel. Change it there, or delete that variable and redeploy to manage the password here.</p>
      ) : done ? (
        <p className="mt-2 text-sm text-good">✔ Password changed. Other devices have been signed out.</p>
      ) : !open ? (
        <p className="mt-2 text-sm text-muted">Changing it signs out every other device.</p>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            if (next.length < 8) return setError("Use at least 8 characters for the new password.");
            if (next !== confirm) return setError("The new passwords don't match.");
            setBusy(true);
            try {
              await api("/api/admin/password", { method: "POST", json: { current, next } });
              setDone(true);
              setOpen(false);
              setCurrent(""); setNext(""); setConfirm("");
            } catch (err) {
              setError((err as ApiError).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Current password">
            <input type="password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            <input type="password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Type the new password again">
            <input type="password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>Save new password</Button>
            <Button type="button" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
