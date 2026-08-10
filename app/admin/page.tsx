import { AdminPanel } from "@/components/admin-panel";

export const metadata = { title: "管理后台" };
export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminPanel />;
}
