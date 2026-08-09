import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createSupabaseAdminClient, SupabaseConfigError } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

function shanghaiBoundaries(now = new Date()) {
  const local = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const date = local.getUTCDate();
  const day = local.getUTCDay();
  const dayStart = Date.UTC(year, month, date) - SHANGHAI_OFFSET_MS;
  const mondayOffset = day === 0 ? 6 : day - 1;
  return {
    today: new Date(dayStart).toISOString(),
    week: new Date(dayStart - mondayOffset * 24 * 60 * 60 * 1_000).toISOString(),
    month: new Date(Date.UTC(year, month, 1) - SHANGHAI_OFFSET_MS).toISOString(),
  };
}

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  try {
    const admin = createSupabaseAdminClient();
    const boundaries = shanghaiBoundaries();
    const countSince = (timestamp: string) => admin
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.user.id)
      .gte("created_at", timestamp);
    const [today, week, month] = await Promise.all([
      countSince(boundaries.today),
      countSince(boundaries.week),
      countSince(boundaries.month),
    ]);
    const error = today.error ?? week.error ?? month.error;
    if (error) throw error;
    return NextResponse.json(
      { data: { today: today.count ?? 0, week: week.count ?? 0, month: month.count ?? 0 } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (!(error instanceof SupabaseConfigError)) console.error("[usage-stats] query_failed");
    return NextResponse.json({ error: "用量统计暂时不可用" }, { status: 503 });
  }
}
