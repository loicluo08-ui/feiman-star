import { NextResponse } from "next/server";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FlashItem {
  id: string;
  title: string;
  content: string;
  content_text: string;
  time_str: string;
  timestamp: number;
  is_important: boolean;
  channels: number[];
  source: string;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/?b>/g, "")
    .replace(/<\/?strong>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function hasBoldTag(html: string): boolean {
  return /<b>|<strong/.test(html);
}

function formatRelativeTime(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 10) return "刚刚";
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return new Date(ts * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function isLowQuality(content: string): boolean {
  if (!content || content.length < 8) return true;
  const lower = content.toLowerCase();
  if (/扫码|加微信|进群|限时|优惠|点击链接/.test(content)) return true;
  if (/笔者认为|我们认为|小编觉得/.test(content)) return true;
  return false;
}

function isEnglishDominant(text: string): boolean {
  if (!text || text.length < 10) return false;
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const letters = (text.match(/[a-zA-Z]/g) || []).length;
  // 中文字符占比<15%且英文字母≥30 → 英文主导（阈值30：拦截短英文快讯，如49字母的CENTCOM条；中文快讯夹少量英文缩写不受影响）
  return chinese / text.length < 0.15 && letters >= 30;
}

function normalizeForDedup(content: string): string {
  // 剥掉金十格式壳：【标题】+ 讯头，否则同事件双源（金十带壳/华尔街纯正文）对不上
  let t = content.replace(/【[^】]*】/g, "");
  t = t.replace(/金十数据\d{1,2}月\d{1,2}日讯[，,]?/g, "");
  // 剥纯英文词：华尔街常插 (CXMT) 等括号注释而金十不写，保留会导致字符错位
  t = t.replace(/[A-Za-z]+/g, "");
  // 注意：不能用 \W（ASCII语义）——会把中文全剥掉，指纹退化成纯数字字母
  // tsconfig target es5 不支持 \p{...} Unicode属性类，用显式中文范围+数字
  t = t.replace(/[^0-9\u4e00-\u9fff]/g, "");
  return t;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源1: 金十（服务端兜底，主源在客户端直连）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface Jin10Raw {
  id: string;
  time: string;
  data: { content: string; title: string; source: string };
  important: number;
  channel: number[];
}

async function fetchJin10(): Promise<FlashItem[]> {
  const cacheBuster = Date.now();
  const urls = [
    `https://www.jin10.com/flash_newest.js?_=${cacheBuster}`,
    `https://cdn.jin10.com/flash_newest.js?_=${cacheBuster}`,
    `https://www.jin10.com/flash_newest.js`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Referer: "https://www.jin10.com/",
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache",
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;

      const text = await res.text();
      if (!text || text.length < 10) continue;

      const match = text.match(/var newest = (.+);/);
      if (!match) continue;

      const raw = JSON.parse(match[1]) as Jin10Raw[];
      return raw.map((item) => {
        const rawContent = item.data.content || "";
        const cleanContent = stripHtml(rawContent);
        const cleanTitle = stripHtml(item.data.title || "");
        const ts = Math.floor(new Date(item.time + " UTC+8").getTime() / 1000);
        return {
          id: `jin10_${item.id}`,
          title: cleanTitle,
          content: cleanContent,
          content_text: cleanTitle ? `${cleanTitle}\n${cleanContent}` : cleanContent,
          time_str: formatRelativeTime(ts),
          timestamp: ts,
          is_important: item.important === 1 || hasBoldTag(rawContent),
          channels: item.channel || [],
          source: "金十数据",
        };
      });
    } catch {
      continue;
    }
  }

  return [];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源2: 华尔街见闻
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface WscnItem {
  id: string;
  title: string;
  content: string;
  display_time: number;
  is_important: boolean;
}

async function fetchWallstreetCN(): Promise<FlashItem[]> {
  try {
    const res = await fetch(
      "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=20",
      {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return [];

    const payload = (await res.json()) as { data?: { items?: WscnItem[] } };
    const items = payload.data?.items ?? [];

    return items.map((item) => {
      const cleanContent = stripHtml(item.content || "");
      const cleanTitle = stripHtml(item.title || "");
      const ts = item.display_time;
      return {
        id: `wscn_${item.id}`,
        title: cleanTitle,
        content: cleanContent,
        content_text: cleanTitle ? `${cleanTitle}\n${cleanContent}` : cleanContent,
        time_str: formatRelativeTime(ts),
        timestamp: ts,
        is_important: item.is_important || false,
        channels: [],
        source: "华尔街见闻",
      };
    });
  } catch {
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源3已删除（财联社API全失效，换成金十第三CDN节点在fetchJin10里）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 缓存兜底（5分钟）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let lastSuccessCache: FlashItem[] = [];
let lastSuccessTime = 0;
const CACHE_TTL = 5 * 60 * 1000;
// 主路径节流缓存：快讯更新频率分钟级，10秒内的重复请求直接回缓存（防前端5秒轮询打穿金十）
let throttleCache: FlashItem[] = [];
let throttleTime = 0;
const THROTTLE_TTL = 10 * 1000;
// 节流命中时也返回完整顶层字段，保持响应结构一致
let throttleSource = "";

function getCachedFallback(): FlashItem[] {
  if (Date.now() - lastSuccessTime < CACHE_TTL && lastSuccessCache.length > 0) {
    return lastSuccessCache;
  }
  return [];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主函数：金十为主，华尔街见闻+财联社补充
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function GET(request: Request) {
  const limited = await enforceRateLimitAsync(request, "flash", RATE_LIMITS.flash);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  // 10秒节流缓存命中→直接返回（前端5秒轮询，快讯分钟级更新，用户零感知）
  if (Date.now() - throttleTime < THROTTLE_TTL && throttleCache.length > 0) {
    return NextResponse.json({
      data: throttleCache,
      timestamp: new Date().toISOString(),
      source: throttleSource || "金十数据",
    });
  }

  const [jin10Items, wscnItems] = await Promise.all([
    fetchJin10(),
    fetchWallstreetCN(),
  ]);

  // 金十为主源，华尔街见闻全量合并（无CDN缓存，实时性好）
  // 之前只在金十延迟时补华尔街见闻，但金十CDN缓存4小时会导致午间延迟17分钟
  // 改为始终合并，靠去重处理重叠
  let all: FlashItem[] = [...jin10Items, ...wscnItems];

  // 质量过滤 + 英文过滤（金十会推英文原文，同一条新闻通常有中文版）
  const filtered = all.filter((i) => !isLowQuality(i.content) && !isEnglishDominant(i.content_text));

  // 去重：前30个归一化字符全等，或一方为另一方前缀且重合≥12字（处理两源详略不同）
  // + 开头14字被已入库条目包含：同事件跨源文案（官方通稿标题两源趋同，但金十壳内标题/正文重复+带日期、
  //   华尔街title独立存content无标题——仅比对content会开头错位漏判，故输入改用content_text并加此兜底）
  // 归一化后<6字的短讯（剥壳剩空壳）直接保留不参与判重，防误杀
  const normTexts: string[] = [];
  const deduped: FlashItem[] = [];
  for (const item of filtered.sort((a, b) => b.timestamp - a.timestamp)) {
    const t = normalizeForDedup(item.content_text);
    const isDup =
      t.length >= 6 &&
      normTexts.some((prev) => {
        if (prev === t) return true;
        if (prev.startsWith(t) || t.startsWith(prev)) return Math.min(prev.length, t.length) >= 12;
        if (t.length >= 14 && prev.includes(t.slice(0, 14))) return true;
        return prev.slice(0, 30) === t.slice(0, 30);
      });
    if (isDup) continue;
    normTexts.push(t);
    deduped.push(item);
  }

  const items = deduped.slice(0, 30);

  // 写节流缓存（成功拿到任何数据就缓存，包括items非空的路径）
  if (items.length > 0) {
    throttleCache = items;
    throttleTime = Date.now();
  }

  if (items.length === 0) {
    const cached = getCachedFallback();
    if (cached.length > 0) {
      return NextResponse.json({
        data: cached,
        timestamp: new Date().toISOString(),
        source: "缓存数据（数据源暂时不可用）",
        fallback: true,
      });
    }

    return NextResponse.json(
      { error: "快讯数据暂时不可用，请稍后重试" },
      { status: 503 },
    );
  }

  lastSuccessCache = items;
  lastSuccessTime = Date.now();

  const sources: string[] = [];
  if (jin10Items.length > 0) sources.push("金十数据");
  if (wscnItems.some((i) => i.timestamp > (jin10Items[0]?.timestamp || 0))) sources.push("华尔街见闻");

  throttleSource = sources.join("+") || "金十数据";

  return NextResponse.json({
    data: items,
    timestamp: new Date().toISOString(),
    source: throttleSource,
    stats: {
      total: items.length,
      jin10: jin10Items.length,
      wscn: wscnItems.length,
    },
  });
}
