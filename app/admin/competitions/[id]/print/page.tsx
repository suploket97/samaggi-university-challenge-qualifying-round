import { isAdmin } from "@/lib/server/auth";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { CompetitionPrint, type PrintKind } from "@/components/admin/CompetitionPrint";

export const dynamic = "force-dynamic";

export default async function CompetitionPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string; team?: string }>;
}) {
  if (!(await isAdmin())) return <AdminLogin />;
  const sp = await searchParams;
  const kind: PrintKind = sp.kind === "qualified" || sp.kind === "team" ? sp.kind : "full";
  return <CompetitionPrint id={decodeURIComponent((await params).id)} kind={kind} teamId={sp.team ?? null} />;
}
