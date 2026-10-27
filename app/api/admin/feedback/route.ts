/**
 * 管理端：读取用户反馈（10/27反馈闭环，/lyx后台"用户反馈"区块用）
 * GET /api/admin/feedback —— header x-admin-token（usage同款模式）
 * fail-closed：无ADMIN_TOKEN配置=503
 */
import { NextResponse } from "next/server";
import { readFeedback, supabaseConfigured } from "@/lib/supabase";

export async function GET(request: Request) {
  const ADMIN = process.env.ADMIN_TOKEN;
  if (!ADMIN) {
    return NextResponse.json({ error: "监控未启用" }, { status: 503 });
  }
  const token = request.headers.get("x-admin-token") || new URL(request.url).searchParams.get("token");
  if (!token || token !== ADMIN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "存储未配置" }, { status: 503 });
  }
  const data = await readFeedback(100);
  if (!data) {
    return NextResponse.json({ error: "读取失败" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rows: data.rows, total: data.total });
}
