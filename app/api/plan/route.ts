import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createSupabaseUserClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const supabase = createSupabaseUserClient(auth.accessToken);
  const { data, error } = await supabase.rpc("get_my_plan");
  if (error) {
    console.error(`[plan] query_failed code=${error.code ?? "unknown"}`);
    return NextResponse.json({ error: "套餐信息暂时不可用" }, { status: 503 });
  }

  const plan = Array.isArray(data) ? data[0] : null;
  return NextResponse.json(
    { data: plan },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
