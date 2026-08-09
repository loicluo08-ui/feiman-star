import { DashboardPanel } from "@/components/dashboard-panel";

export const metadata = { title: "用户中心" };
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <DashboardPanel />;
}
