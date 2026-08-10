import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createSupabaseAdminClient, SupabaseConfigError } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function shanghaiDayStart() {
  const offset = 8 * 60 * 60 * 1_000;
  const local = new Date(Date.now() + offset);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset).toISOString();
}

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const admin = createSupabaseAdminClient();
    const todayStart = shanghaiDayStart();
    const [authResult, plansResult, codesResult, usageResult] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
      admin.from("user_plans").select("user_id,plan,remaining_calls,daily_limit,expires_at,updated_at"),
      admin.from("codes").select("id,code,plan,is_used,used_by,used_at,created_at").order("created_at", { ascending: false }).limit(500),
      admin.from("ai_usage_events").select("user_id,endpoint,created_at").gte("created_at", todayStart).limit(10_000),
    ]);
    if (authResult.error) throw authResult.error;
    const error = plansResult.error ?? codesResult.error ?? usageResult.error;
    if (error) throw error;

    const planByUser = new Map((plansResult.data ?? []).map((plan) => [plan.user_id, plan]));
    const users = authResult.data.users.map((user) => {
      const plan = planByUser.get(user.id);
      return {
        user_id: user.id,
        email: user.email ?? "—",
        plan: plan?.plan ?? "free",
        remaining_calls: plan?.remaining_calls ?? 15,
        daily_limit: plan?.daily_limit ?? 15,
        expires_at: plan?.expires_at ?? null,
        created_at: user.created_at,
      };
    });
    const todayEvents = usageResult.data ?? [];
    return NextResponse.json(
      {
        data: {
          stats: {
            total_users: users.length,
            active_users_today: new Set(todayEvents.map((item) => item.user_id)).size,
            api_calls_today: todayEvents.length,
          },
          users,
          codes: codesResult.data ?? [],
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (!(error instanceof SupabaseConfigError)) console.error("[admin-overview] query_failed");
    return NextResponse.json({ error: "管理数据暂时不可用" }, { status: 503 });
  }
}
