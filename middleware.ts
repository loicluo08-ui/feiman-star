import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";

// 使用监控采集（10/1逸翔令：后台看每个用户使用情况+IP）
// 设计：/invest/*页面与API全量采集，fire-and-forget写Supabase access_logs（表见sql/005_access_logs.sql），
// 写入失败静默（监控不阻塞主功能）。IP取x-forwarded-for首段，geo用Vercel注入头（免费）。
// 排除：/admin自身（防自记录死循环）、无IP的本地健康检查。

const SUPABASE_URL = process.env.SUPABASE_URL || "";
// 与lib/supabase.ts同款cleanKey（env值混入中文标点致fetch header ByteString错的先例防御）
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "")
  .replace(/[^\x20-\x7E]/g, "")
  .trim();

function clientIP(req: NextRequest): string {
  // 10/1修复：域名套了Cloudflare代理——真实访客IP在CF-Connecting-IP头（实测x-forwarded-for拿到的是CF节点IP非访客IP）
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// 恶意爬虫UA特征（合规界限内：robots.txt已声明禁止，此处是技术执行）
const BAD_BOT_RE = /python-requests|python-urllib|scrapy|aiohttp|httpx|go-http-client|java\/|okhttp|libwww|curl\/|wget\//i;
// IP黑名单内存缓存（来源kb_dynamic type=ip_block，后台cleanup/usage可管理；2分钟刷新）
const BLOCKED_IPS = new Set<string>();
let blLastRefresh = 0;
function refreshBlocklistOnce() {
  const now = Date.now();
  if (now - blLastRefresh < 120_000) return;
  blLastRefresh = now;
  if (!(SUPABASE_URL && SUPABASE_KEY)) return;
  fetch(`${SUPABASE_URL}/rest/v1/kb_dynamic?type=eq.ip_block&select=content&order=created.desc&limit=200`, {
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
    cache: "no-store",
  }).then((r) => (r.ok ? r.json() : [])).then((rows: Array<{ content: string }>) => {
    BLOCKED_IPS.clear();
    for (const row of rows || []) {
      try {
        const ip = JSON.parse(row.content).ip;
        if (ip) BLOCKED_IPS.add(ip);
      } catch { /* 坏行跳过 */ }
    }
  }).catch(() => {});
}

// 已知搜索引擎爬虫（合规放行公开页，禁API——robots.txt同口径）
const SEARCH_BOT_RE = /googlebot|bingbot|baiduspider|sogou|duckduckbot|yandexbot/i;
// AI成本敏感接口（POST=真实调用AI消耗算力）
const AI_PATHS = ["/api/invest/chat", "/api/invest/pick", "/api/invest/review-summary", "/api/invest/flash-analyze"];

// ── 访问意图分类（10/1逸翔令：真实访问用户模块+分辨意图）──
const SEARCH_ENGINE_RE = /googlebot|bingbot|baiduspider|sogou|duckduckbot|yandexbot|applebot/i;
const AI_CRAWLER_RE = /gptbot|claudebot|claude-web|ccbot|perplexitybot|google-extended|bytespider|anthropic-ai|amazonbot|diffbot/i;
const SCAN_PATH_RE = /wp-admin|wp-login|\.env|phpmyadmin|\.git\/|config\.php|admin\.php|xmlrpc|\/shell|\.asp$|\.jsp$|\/eval-|phpinfo/i;

function classifyVisit(ua: string, path: string, method: string): string {
  if (SCAN_PATH_RE.test(path)) return "scan"; // 漏洞扫描（恶意）
  if (SEARCH_ENGINE_RE.test(ua)) return "searchbot"; // 搜索引擎（无害，SEO）
  if (AI_CRAWLER_RE.test(ua)) return "aicrawler"; // AI公司训练爬虫（数据抓取）
  if (BAD_BOT_RE.test(ua)) return "badbot"; // 已声明禁止的恶意爬虫
  if (!ua) return method === "POST" ? "badbot" : "unknown"; // 空UA的POST=脚本
  return "human"; // 正常浏览器=真实访客
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");

  const path = request.nextUrl.pathname;
  if (path.startsWith("/lyx") || path.startsWith("/invest/admin")) return response; // 后台自身不记录（/lyx本不在matcher内，防御性保留）

  const ua = request.headers.get("user-agent") || "";
  const ip = clientIP(request);
  const isAPI = path.startsWith("/api/invest/");

  // 合规反爬第一层：黑名单IP→全站403（黑名单存kb_dynamic type=ip_block，后台可管理）
  // 检查以异步缓存方式进行：每2分钟刷新一次黑名单（Edge/Node内存缓存，避免每请求查库）
  if (BLOCKED_IPS.size > 0 && BLOCKED_IPS.has(ip)) {
    return new NextResponse("访问已被限制", { status: 403 });
  }
  refreshBlocklistOnce();

  // 合规反爬第二层：恶意爬虫UA调AI接口→403（robots.txt已声明禁止=合规依据）
  if (isAPI && request.method === "POST" && BAD_BOT_RE.test(ua)) {
    return new NextResponse("自动化访问已被限制（见robots.txt）", { status: 403 });
  }
  // 搜索引擎爬虫禁止调AI接口（公开页面随便爬）
  if (isAPI && request.method === "POST" && SEARCH_BOT_RE.test(ua)) {
    return new NextResponse("搜索引擎不应调用分析接口", { status: 403 });
  }
  // 空UA POST调AI接口→403（正常浏览器必有UA）
  if (isAPI && request.method === "POST" && !ua) {
    return new NextResponse("自动化访问已被限制", { status: 403 });
  }

  // 采集：Supabase配置完整才发。存储=kb_dynamic表（type="access_log"，零DDL立即可用——
  // access_logs专用表见sql/005，逸翔执行后可迁移）；写入失败静默（监控永不阻塞主功能）
  if (SUPABASE_URL && SUPABASE_KEY) {
    const ip = clientIP(request);
    const now = new Date().toISOString();
    const logEntry = {
      ts: new Date().toISOString(),  // 10/1修复：created列是date类型只存日期——完整时间戳放content里
      user_type: classifyVisit(ua, path, request.method),  // 意图分类：human/searchbot/aicrawler/badbot/scan/unknown
      ip,
      path,
      method: request.method,
      ua: (request.headers.get("user-agent") || "").slice(0, 300),
      // 10/1 geo修正：CF代理下x-vercel-ip-*读到的是CF边缘节点位置（实测SG/Seattle/Vancouver全是节点非访客）——
      // 真实国家在CF-IPCountry头；城市CF免费版不提供，CF代理下置null（宁空勿错，节点城市显示出来是假情报）
      country: request.headers.get("cf-ipcountry")
        || request.headers.get("x-vercel-ip-country")
        || null,
      city: request.headers.get("cf-connecting-ip")
        ? null
        : request.headers.get("x-vercel-ip-city") || null,
      referer: (request.headers.get("referer") || "").slice(0, 300),
    };
    const payload = JSON.stringify({
      id: `acc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "access_log",
      keywords: [],
      content: JSON.stringify(logEntry),
      source: "middleware",
      created: now,
    });
    try {
      // waitUntil挂住fetch生命周期（10/1实测：Edge响应完成后floating fetch被平台砍=写入全丢——
      // 活动流0条实锤），waitUntil让平台等写入完成再回收
      waitUntil(fetch(`${SUPABASE_URL}/rest/v1/kb_dynamic`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: payload,
        cache: "no-store",
      }));
    } catch {
      // 监控永不阻塞主功能
    }
  }

  return response;
}

export const config = {
  // 10/1补盲区：加"/"（主页第一入口此前未记录）+"/api/invest/*"（AI接口此前从未经过检查层——反爬/黑名单/采集三功能对API全部失效的根因）
  // runtime切Node：Edge下Supabase写入静默全丢（waitUntil也0条实测）——Node runtime与API route同环境，env/fetch行为一致
  runtime: "nodejs",
  matcher: ["/", "/invest/:path*", "/api/invest/:path*"],
};
