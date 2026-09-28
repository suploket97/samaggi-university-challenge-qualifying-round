import { isAdmin } from "@/lib/server/auth";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { CompetitionView } from "@/components/admin/CompetitionView";

export const dynamic = "force-dynamic";

export default async function CompetitionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return <AdminLogin />;
  return <CompetitionView id={decodeURIComponent((await params).id)} />;
}
