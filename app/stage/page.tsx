"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Logo, inputClass } from "@/components/ui";

export default function StageEntry() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <Logo className="text-3xl" />
      <h1 className="mt-8 font-headline text-4xl font-bold">Open the big screen</h1>
      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length >= 4) router.push(`/stage/${code}`);
        }}
      >
        <Field label="Room code" hint="Create a room in the host console first.">
          <input
            className={`${inputClass} h-16 text-center font-mono text-3xl font-bold uppercase tracking-[0.4em]`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
            placeholder="ABCDE"
          />
        </Field>
        <Button type="submit" size="lg" className="w-full">Open stage</Button>
      </form>
    </main>
  );
}
