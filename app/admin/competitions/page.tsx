import { isAdmin } from "@/lib/server/auth";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { CompetitionList } from "@/components/admin/CompetitionList";

export const dynamic = "force-dynamic";

export default async function CompetitionsPage() {
  if (!(await isAdmin())) return <AdminLogin />;
  return <CompetitionList />;
}
