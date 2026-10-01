import { NextRequest, NextResponse } from "next/server";
import { supabaseConfigured, sbRest } from "@/lib/supabase";

/**
 * 使用监控聚合API（10/1逸翔令）：GET /api/admin/usage?token=ADMIN_TOKEN
 * 返回：总览（独立IP/请求数/AI调用/对话数）+ IP明细 + 最近活动流 + 对话记录
 * 鉴权：?token=对比ADMIN_TOKEN（balance-check同款模式），无ADMIN_TOKEN配置=503关闭
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ADMIN = process.env.ADMIN_TOKEN;
  if (!ADMIN) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  // 10/2漏洞审计P2修复：header优先（token不进URL=不进CDN日志/浏览器历史/Referer）；query保留兼容旧链接
  const token = request.headers.get("x-admin-token") || new URL(request.url).searchParams.get("token");
  if (token !== ADMIN) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!supabaseConfigured()) return NextResponse.json({ error: "supabase_not_configured" }, { status: 501 });

  let body: { action?: string; ip?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const ip = (body.ip || "").trim();
  const action = body.action;
  if (!ip || !["block", "unblock"].includes(action || "")) {
    return NextResponse.json({ error: "need_ip_and_action" }, { status: 400 });
  }

  try {
    if (action === "block") {
      const row = {
        id: `ipblock-${ip.replace(/[^A-Za-z0-9]/g, "-")}`,
        type: "ip_block",
        keywords: [],
        content: JSON.stringify({ ip, blocked_at: new Date().toISOString() }),
        source: "admin",
        created: new Date().toISOString(),
      };
      await sbRest("kb_dynamic?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: row,
      });
      return NextResponse.json({ ok: true, action: "blocked", ip });
    }
    // unblock
    await sbRest(`kb_dynamic?id=eq.${encodeURIComponent(`ipblock-${ip.replace(/[^A-Za-z0-9]/g, "-")}`)}`, { method: "DELETE" });
    return NextResponse.json({ ok: true, action: "unblocked", ip });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "block_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const ADMIN = process.env.ADMIN_TOKEN;
  if (!ADMIN) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  // 10/2漏洞审计P2修复：header优先（token不进URL=不进CDN日志/浏览器历史/Referer）；query保留兼容旧链接
  const token = request.headers.get("x-admin-token") || new URL(request.url).searchParams.get("token");
  if (token !== ADMIN) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 501 });
  }

  try {
    // 并行拉：访问日志（kb_dynamic type=access_log，10/1改零DDL立即可用）最近500 + 对话日志最近50
    const [kbRaw, chats] = await Promise.all([
      // 10/2修复：access_log已超500条，limit窗口把最新行（含username）截掉——created是date类型，
      // order=created.desc同天并列排序不稳定。改7天滚动窗口+limit=1000（与"保留7天"清理语义对齐，旧数据查不到）
      sbRest<Array<Record<string, unknown>>>(`kb_dynamic?type=eq.access_log&created=gte.${new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)}&select=id,content,created&order=created.desc&limit=1000`),
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
      const ua = (log.ua as string) || "";
      const pth = (log.path as string) || "";
      const mth = (log.method as string) || "GET";
      // 旧记录无user_type字段→运行时按UA+路径补分类（与middleware同口径）
      let userType = (log.user_type as string) || "";
      if (!userType) {
        if (/wp-admin|\.env|phpmyadmin|\.git|xmlrpc/i.test(pth)) userType = "scan";
        else if (/googlebot|bingbot|baiduspider|sogou|duckduckbot|applebot/i.test(ua)) userType = "searchbot";
        else if (/gptbot|claudebot|ccbot|perplexitybot|bytespider/i.test(ua)) userType = "aicrawler";
        else if (/python|scrapy|curl\/|wget|okhttp|aiohttp|httpx|go-http/i.test(ua) || (!ua && mth === "POST")) userType = "badbot";
        else if (/mozilla|chrome|safari|firefox|edge/i.test(ua)) userType = "human";
        else userType = "unknown";
      }
      return {
        ts: (log.ts as string) || (r.created as string) || "",
        ip: (log.ip as string) || "unknown",
        path: pth,
        method: mth,
        ua,
        country: (log.country as string) || null,
        city: (log.city as string) || null,
        user_type: userType,
        username: (log.username as string) || null,  // 10/2自称式用户名（middleware cookie写入）
        user_city: (log.user_city as string) || null,  // 10/2自报城市
        geo: (globalThis as { __geoCache?: Map<string, string> }).__geoCache?.get((log.ip as string) || "") || "",
      };
    });
    const chatList = chats ?? [];

    // 聚合：按IP
    const byIP = new Map<string, { count: number; first: string; last: string; paths: Set<string>; country: string | null; city: string | null; username: string | null; user_city: string | null }>();
    for (const r of accessList) {
      const ip = (r.ip as string) || "unknown";
      const e = byIP.get(ip) || { count: 0, first: r.ts as string, last: r.ts as string, paths: new Set<string>(), country: (r.country as string) || null, city: (r.city as string) || null, username: (r.username as string) || null, user_city: (r.user_city as string) || null };
      e.count += 1;
      // 10/2：名字/城市取首个非空（与humanIPs同口径——拉黑板块/IP明细同步显示）
      if (!e.username && r.username) e.username = r.username as string;
      if (!e.user_city && r.user_city) e.user_city = r.user_city as string;
      if ((r.ts as string) < e.first) e.first = r.ts as string;
      if ((r.ts as string) > e.last) e.last = r.ts as string;
      e.paths.add(r.path as string);
      byIP.set(ip, e);
    }
    const ipRows = Array.from(byIP.entries())
      .map(([ip, e]) => ({ ip, count: e.count, first: e.first, last: e.last, paths: Array.from(e.paths).slice(0, 6), country: e.country, city: e.city, username: e.username, user_city: e.user_city }))
      .sort((a, b) => b.count - a.count);

    // 聚合：AI调用数（chat/pick-analyze/flash-analyze/review-summary等AI端点）
    const aiPaths = ["/invest/chat", "/invest/pick", "/invest/review-summary", "/invest/flash-analyze"];
    const aiCount = accessList.filter((r) => aiPaths.some((p) => (r.path as string).startsWith(p) && (r.method as string) === "POST")).length;

    const now = Date.now();
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

    // 10/1中文归属地（逸翔令：监控内容用中文）——ip-api批量中文查询+24h缓存
    const geoCache = (globalThis as { __geoCache?: Map<string, string> }).__geoCache || new Map<string, string>();
    (globalThis as { __geoCache?: Map<string, string> }).__geoCache = geoCache;
    const unknownIPs = ipRows.map((r) => r.ip).filter((ip) => ip && ip !== "unknown" && !geoCache.has(ip));
    if (unknownIPs.length > 0 && unknownIPs.length <= 100) {
      try {
        const geoRes = await fetch(
          `http://ip-api.com/batch?fields=status,country,regionName,city,query&lang=zh-CN`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(unknownIPs),
            signal: AbortSignal.timeout(6000),
          },
        );
        if (geoRes.ok) {
          const list = (await geoRes.json()) as Array<{ status: string; country?: string; regionName?: string; city?: string; query?: string }>;
          for (const g of list) {
            if (g.status === "success" && g.query) {
              const parts = [g.country, g.regionName, g.city].filter(Boolean);
              geoCache.set(g.query, parts.join(" ") || "未知");
            }
          }
        }
      } catch {
        // 归属地查询失败不影响主数据（显示回退为IP原文）
      }
    }
    // 合并中文归属地到ipRows与recent
    for (const r of ipRows) {
      (r as { geo?: string }).geo = geoCache.get(r.ip) || "";
    }
    for (const r of accessList) {
      (r as { geo?: string }).geo = geoCache.get(r.ip) || "";
    }

    // 10/1逸翔令：按先后顺序排列——正序显示（早的在上，最新的在下）
    accessList.reverse();
    chatList.reverse();

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
      // 10/1意图分类统计+真实访客模块数据（逸翔令）
      intentStats: {
        human: accessList.filter((r) => r.user_type === "human").length,
        searchbot: accessList.filter((r) => r.user_type === "searchbot").length,
        aicrawler: accessList.filter((r) => r.user_type === "aicrawler").length,
        badbot: accessList.filter((r) => r.user_type === "badbot").length,
        scan: accessList.filter((r) => r.user_type === "scan").length,
        unknown: accessList.filter((r) => r.user_type === "unknown").length,
      },
      humanIPs: Array.from(
        accessList.filter((r) => r.user_type === "human").reduce((m, r) => {
          const ip = r.ip as string;
          const e = m.get(ip) || { ip, count: 0, first: r.ts as string, last: r.ts as string, paths: new Set<string>(), geo: (r.geo as string) || "", username: (r.username as string) || null, user_city: (r.user_city as string) || null };
          e.count += 1;
          // 10/2修复：username取首个非空（历史无名字行先出现会把null锁死——新标记后仍显示—）
          if (!e.username && r.username) e.username = (r.username as string);
          if (!e.user_city && r.user_city) e.user_city = (r.user_city as string);
          if ((r.ts as string) < e.first) e.first = r.ts as string;
          if ((r.ts as string) > e.last) e.last = r.ts as string;
          e.paths.add(r.path as string);
          m.set(ip, e);
          return m;
        }, new Map()).values(),
      ).map((e) => ({ ...e, paths: Array.from(e.paths).slice(0, 6) })),
      ipRows,
      recent: accessList.slice(0, 80),
      chats: chatList.map((c) => ({
        ...c,
        // 10/2：对话记录按IP关联显示名（同名多IP取IP表中首个非空名字）
        username: (byIP.get((c.ip as string) || "unknown") as { username?: string } | undefined)?.username ?? null,
        user_city: (byIP.get((c.ip as string) || "unknown") as { user_city?: string } | undefined)?.user_city ?? null,
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "query_failed" }, { status: 500 });
  }
}
