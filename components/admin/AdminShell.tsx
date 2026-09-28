"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Logo } from "@/components/ui";

export function AdminShell({ children, title, actions }: { children: React.ReactNode; title?: React.ReactNode; actions?: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="min-h-dvh">
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line/70 px-5 py-3">
        <Link href="/admin"><Logo className="text-lg" /></Link>
        <Link href="/admin" className="whitespace-nowrap text-sm text-muted hover:text-white">Rooms</Link>
        <Link href="/admin/bank" className="whitespace-nowrap text-sm text-muted hover:text-white">Question bank</Link>
        <Link href="/admin/competitions" className="whitespace-nowrap text-sm text-muted hover:text-white">Competition log</Link>
        <button
          className="ml-auto text-sm text-muted hover:text-white"
          onClick={async () => {
            await api("/api/admin/logout", { method: "POST" }).catch(() => {});
            router.refresh();
          }}
        >
          Log out
        </button>
      </nav>
      <div className="mx-auto max-w-7xl px-5 py-6">
        {title || actions ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <h1 className="font-headline text-3xl font-bold">{title}</h1>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
