import { isAdmin } from "@/lib/server/auth";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { QuestionSheetPrint } from "@/components/admin/QuestionSheetPrint";

export const dynamic = "force-dynamic";

export default async function QuestionSheetPage({ searchParams }: { searchParams: Promise<{ pack?: string; answers?: string }> }) {
  if (!(await isAdmin())) return <AdminLogin />;
  const sp = await searchParams;
  if (!sp.pack) return <p style={{ padding: 24 }}>Choose a pack from the question bank.</p>;
  return <QuestionSheetPrint packId={sp.pack} answers={sp.answers === "1"} />;
}
