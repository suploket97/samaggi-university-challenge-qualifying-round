import { isAdmin } from "@/lib/server/auth";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { RoomControl } from "@/components/admin/RoomControl";

export const dynamic = "force-dynamic";

export default async function RoomControlPage({ params }: { params: Promise<{ code: string }> }) {
  if (!(await isAdmin())) return <AdminLogin />;
  const { code } = await params;
  return <RoomControl code={code.toUpperCase()} />;
}
