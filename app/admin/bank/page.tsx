import { isAdmin } from "@/lib/server/auth";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { BankManager } from "@/components/admin/BankManager";

export const dynamic = "force-dynamic";

export default async function BankPage() {
  if (!(await isAdmin())) return <AdminLogin />;
  return <BankManager />;
}
