import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { supabaseConfigured, sbRest } from "@/lib/supabase";

/**
 * 使用监控聚合API（10/1逸翔令）：GET /api/admin/usage?token=ADMIN_TOKEN
 * 返回：总览（独立IP/请求数/AI调用/对话数）+ IP明细 + 最近活动流 + 对话记录
 * 鉴权：?token=对比ADMIN_TOKEN（balance-check同款模式），无ADMIN_TOKEN配置=503关闭
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "admin", RATE_LIMITS.admin);
  if (limited) return NextResponse.json({ ok: false, error: "rate_limited", retryAfter: limited.retryAfter }, { status: 429 });

  const ADMIN = process.env.ADMIN_TOKEN;
  if (!ADMIN) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  // 10/2漏洞审计P2修复：header优先（token不进URL=不进CDN日志/浏览器历史/Referer）；query保留兼容旧链接 (安全审计修复10/3：P0×3（FX_GATE_TOKEN共享口令闸：7个AI路由open-until-configured+judgment-cloud/judgment-sync/team-upload写路径fail-closed；judgment-cloud限流30→10；insertChatLog IP改取cf-connecting-ip防伪造）+P1（admin五路由节流20每分+x-admin-token header兼容cron旧?token=；AI端点限流收紧300→20/120→10）+前端gateFetch自动prompt重试（5页面10调用点）+yarn.lock重生成（顺手修frozen-lockfile失配）+env.example补全——build绿20/20)
  const token = request.headers.get("x-admin-token") || new URL(request.url).searchParams.get("token");
  if (token !== ADMIN) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!supabaseConfigured()) return NextResponse.json({ error: "supabase_not_configured" }, { status: 501 });

  let body: { action?: string; ip?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const ip = (body.ip || "").trim();
  const action = body.action;
  // 10/2 P1-E：名字解绑（不需要ip）——POST {action:"unbind", name:"X"}
  if (action === "unbind") {
    const uname = (body as { name?: string }).name || "";
    if (!uname) return NextResponse.json({ error: "need_name" }, { status: 400 });
    const rows = await sbRest<Array<{ id: string; content: string }>>("kb_dynamic?type=eq.username_claim&select=id,content");
    let deleted = 0;
    for (const row of rows ?? []) {
      let nm = "";
      try {
        nm = (JSON.parse(row.content) as { name?: string }).name || "";
      } catch {
        continue;
      }
      if (nm === uname) {
        await sbRest(`kb_dynamic?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" });
        deleted += 1;
      }
    }
    return NextResponse.json({ ok: true, action: "unbind", name: uname, deleted });
  }

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
  const limited = await enforceRateLimitAsync(request, "admin", RATE_LIMITS.admin);
  if (limited) return NextResponse.json({ ok: false, error: "rate_limited", retryAfter: limited.retryAfter }, { status: 429 });

  const ADMIN = process.env.ADMIN_TOKEN;
  if (!ADMIN) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  // 10/2漏洞审计P2修复：header优先（token不进URL=不进CDN日志/浏览器历史/Referer）；query保留兼容旧链接 (安全审计修复10/3：P0×3（FX_GATE_TOKEN共享口令闸：7个AI路由open-until-configured+judgment-cloud/judgment-sync/team-upload写路径fail-closed；judgment-cloud限流30→10；insertChatLog IP改取cf-connecting-ip防伪造）+P1（admin五路由节流20每分+x-admin-token header兼容cron旧?token=；AI端点限流收紧300→20/120→10）+前端gateFetch自动prompt重试（5页面10调用点）+yarn.lock重生成（顺手修frozen-lockfile失配）+env.example补全——build绿20/20)
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
      // 10/2终极修复：id前缀=毫秒时间戳（acc-{Date.now()}-rand），order=id.desc=严格插入时间降序——
      // created(date列)同值组内排序不稳定+localeCompare的locale语义不可控（10/2晚两轮修复未根治），DB端id序一步到位
      sbRest<Array<Record<string, unknown>>>(`kb_dynamic?type=eq.access_log&created=gte.${new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)}&select=id,content,created&order=id.desc&limit=1000`),
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
        geo: (globalThis as { __geoCache?: Map<string, string> }).__geoCache?.get((log.ip as string) || "") || "",
      };
    });


    const chatList = chats ?? [];

    // 聚合：按IP
    const byIP = new Map<string, { count: number; first: string; last: string; paths: Set<string>; country: string | null; city: string | null; username: string | null }>();
    for (const r of accessList) {
      const ip = (r.ip as string) || "unknown";
      const e = byIP.get(ip) || { count: 0, first: r.ts as string, last: r.ts as string, paths: new Set<string>(), country: (r.country as string) || null, city: (r.city as string) || null, username: (r.username as string) || null };
      e.count += 1;
      // 10/2：名字/城市取首个非空（与humanIPs同口径——拉黑板块/IP明细同步显示）
      if (!e.username && r.username) e.username = r.username as string;
      if ((r.ts as string) < e.first) e.first = r.ts as string;
      if ((r.ts as string) > e.last) e.last = r.ts as string;
      e.paths.add(r.path as string);
      byIP.set(ip, e);
    }
    const ipRows = Array.from(byIP.entries())
      .map(([ip, e]) => ({ ip, count: e.count, first: e.first, last: e.last, paths: Array.from(e.paths).slice(0, 6), country: e.country, city: e.city, username: e.username }))
      .sort((a, b) => b.count - a.count);

    // 聚合：AI调用数（chat/pick-analyze/flash-analyze/review-summary等AI端点）
    const aiPaths = ["/invest/chat", "/invest/pick", "/invest/review-summary", "/invest/flash-analyze"];
    const aiCount = accessList.filter((r) => aiPaths.some((p) => (r.path as string).startsWith(p) && (r.method as string) === "POST")).length;

    const now = Date.now();
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

    // 10/1中文归属地（逸翔令：监控内容用中文）——ip-api批量中文查询
    // 10/2 P2修复：缓存持久化到kb_dynamic（type=geo_cache）——原globalThis实例内存在Vercel多实例/冷启动下频繁失效重复打ip-api
    const geoCache = (globalThis as { __geoCache?: Map<string, string> }).__geoCache || new Map<string, string>();
    (globalThis as { __geoCache?: Map<string, string> }).__geoCache = geoCache;
    try {
      const persisted = await sbRest<Array<{ id: string; content: string }>>("kb_dynamic?type=eq.geo_cache&select=id,content&order=created.desc&limit=300");
      for (const row of persisted ?? []) {
        try {
          const o = JSON.parse(row.content) as { ip?: string; label?: string };
          if (o.ip && o.label && !geoCache.has(o.ip)) geoCache.set(o.ip, o.label);
        } catch { /* 坏行跳过 */ }
      }
    } catch { /* 持久层读取失败用内存缓存兜底 */ }
    // D4修复：内存上限（Map无限增长——Vercel实例长期存活内存缓涨）
    if (geoCache.size > 500) {
      // Iterator展开与tsconfig target冲突——改用Array.from前100键删除
      const oldest = Array.from(geoCache.keys()).slice(0, 100);
      for (const k of oldest) geoCache.delete(k);
    }
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
          const persist: Array<Record<string, unknown>> = [];
          for (const g of list) {
            if (g.status === "success" && g.query) {
              const parts = [g.country, g.regionName, g.city].filter(Boolean);
              const label = parts.join(" ") || "未知";
              geoCache.set(g.query, label);
              persist.push({
                // D3修复：id不含月份（同IP更新不堆积）+merge-duplicates
                id: `geo-${g.query.replace(/[^A-Za-z0-9]/g, "-").slice(0, 40)}`,
                type: "geo_cache",
                keywords: [],
                content: JSON.stringify({ ip: g.query, label }),
                source: "usage-geo",
                created: new Date().toISOString(),
              });
            }
          }
          if (persist.length > 0) {
            // 回写失败静默（下次冷启动重查一次，无损）
            void sbRest("kb_dynamic", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: persist }).catch(() => null);
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
          // P2聚合键修复：有名字按名字聚合（同人跨IP合并），无名字按IP——家庭WiFi同IP两人不再错挂名
          const ip = r.ip as string;
          const uname = (r.username as string) || null;
          const aggKey = uname ? `n:${uname}` : `ip:${ip}`;
          const e = m.get(aggKey) || { ip, count: 0, first: r.ts as string, last: r.ts as string, paths: new Set<string>(), ips: new Set<string>(), geo: (r.geo as string) || "", username: uname };
          e.count += 1;
          // A2修复：聚合行收集全部IP（同名多设备3个IP——拉黑/排查时找得到，不只首IP）
          e.ips.add(ip);
          // username取首个非空
          if (!e.username && r.username) e.username = (r.username as string);
          if ((r.ts as string) < e.first) e.first = r.ts as string;
          if ((r.ts as string) > e.last) e.last = r.ts as string;
          e.paths.add(r.path as string);
          m.set(ip, e);
          return m;
        }, new Map()).values(),
      ).map((e) => ({ ...e, paths: Array.from(e.paths).slice(0, 6), ips: Array.from(e.ips) })),
      ipRows,
      recent: accessList.slice(0, 80),


      // 10/2调试v3：JS处理后的accessList头部——看今天的行是否在JS层丢失

      chats: chatList.map((c) => ({
        ...c,
        // 10/2：对话记录按IP关联显示名（同名多IP取IP表中首个非空名字）
        username: (byIP.get((c.ip as string) || "unknown") as { username?: string } | undefined)?.username ?? null,
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "query_failed" }, { status: 500 });
  }
}
