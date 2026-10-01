import { NextRequest, NextResponse } from "next/server";
import { supabaseConfigured, sbRest } from "@/lib/supabase";

/**
 * 使用监控聚合API（10/1逸翔令）：GET /api/admin/usage?token=ADMIN_TOKEN
 * 返回：总览（独立IP/请求数/AI调用/对话数）+ IP明细 + 最近活动流 + 对话记录
 * 鉴权：?token=对比ADMIN_TOKEN（balance-check同款模式），无ADMIN_TOKEN配置=503关闭
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ADMIN = process.env.ADMIN_TOKEN;
  if (!ADMIN) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  const token = new URL(request.url).searchParams.get("token");
  if (token !== ADMIN) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 501 });
  }

  try {
    // 并行拉：访问日志（kb_dynamic type=access_log，10/1改零DDL立即可用）最近500 + 对话日志最近50
    const [kbRaw, chats] = await Promise.all([
      sbRest<Array<Record<string, unknown>>>("kb_dynamic?type=eq.access_log&select=id,content,created&order=created.desc&limit=500"),
      sbRest<Array<Record<string, unknown>>>("chat_logs?select=id,question,style&order=id.desc&limit=50"),
    ]);

    // kb_dynamic行解包：content JSON={ip,path,method,ua,country,city,referer}，created当ts
    const accessList = (kbRaw ?? []).map((r) => {
      let log: Record<string, unknown> = {};
      try {
        log = JSON.parse(r.content as string) as Record<string, unknown>;
      } catch {
        /* 坏行按空字段处理 */
      }
      return {
        ts: (r.created as string) || "",
        ip: (log.ip as string) || "unknown",
        path: (log.path as string) || "",
        method: (log.method as string) || "GET",
        ua: (log.ua as string) || null,
        country: (log.country as string) || null,
        city: (log.city as string) || null,
      };
    });
    const chatList = chats ?? [];

    // 聚合：按IP
    const byIP = new Map<string, { count: number; first: string; last: string; paths: Set<string>; country: string | null; city: string | null }>();
    for (const r of accessList) {
      const ip = (r.ip as string) || "unknown";
      const e = byIP.get(ip) || { count: 0, first: r.ts as string, last: r.ts as string, paths: new Set<string>(), country: (r.country as string) || null, city: (r.city as string) || null };
      e.count += 1;
      if ((r.ts as string) < e.first) e.first = r.ts as string;
      if ((r.ts as string) > e.last) e.last = r.ts as string;
      e.paths.add(r.path as string);
      byIP.set(ip, e);
    }
    const ipRows = Array.from(byIP.entries())
      .map(([ip, e]) => ({ ip, count: e.count, first: e.first, last: e.last, paths: Array.from(e.paths).slice(0, 6), country: e.country, city: e.city }))
      .sort((a, b) => b.count - a.count);

    // 聚合：AI调用数（chat/pick-analyze/flash-analyze/review-summary等AI端点）
    const aiPaths = ["/invest/chat", "/invest/pick", "/invest/review-summary", "/invest/flash-analyze"];
    const aiCount = accessList.filter((r) => aiPaths.some((p) => (r.path as string).startsWith(p) && (r.method as string) === "POST")).length;

    const now = Date.now();
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

    return NextResponse.json({
      ok: true,
      overview: {
        uniqueIPs: ipRows.length,
        totalRequests: accessList.length,
        requests24h: accessList.filter((r) => (r.ts as string) >= dayAgo).length,
        requests7d: accessList.filter((r) => (r.ts as string) >= weekAgo).length,
        aiCalls: aiCount,
        chatCount: chatList.length,
      },
      ipRows,
      recent: accessList.slice(0, 80),
      chats: chatList,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "query_failed" }, { status: 500 });
  }
}
