// 快讯数据源公共模块（9/6从flash route抽出）
// 供 flash route 和 chat 实时讯息注入共用——同一serverless实例共享节流缓存
import { isLowQuality, isEnglishDominant, dedupFlashItems } from "@/lib/flash-filter";

export interface FlashItem {
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
// 缓存（模块级，同实例内flash route与chat route共享）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let lastSuccessCache: FlashItem[] = [];
let lastSuccessTime = 0;
const CACHE_TTL = 5 * 60 * 1000;
// 主路径节流缓存：快讯更新频率分钟级，10秒内的重复请求直接回缓存（防前端5秒轮询打穿金十）
let throttleCache: FlashItem[] = [];
let throttleTime = 0;
const THROTTLE_TTL = 10 * 1000;
let throttleSource = "";

// 刷新进度去重：并发请求（flash轮询+chat提问同时打进来）只触发一次外呼
let refreshPromise: Promise<{ items: FlashItem[]; source: string }> | null = null;

export interface FlashFeed {
  items: FlashItem[];
  source: string;
}

/**
 * 拉取合并去重后的快讯列表（≤30条，最新在前）。
 * 10秒节流 + 5分钟兜底缓存，供flash route与chat共用。
 * 失败返回空items（调用方自行降级，不throw）。
 */
export async function getFlashFeed(): Promise<FlashFeed> {
  // 节流命中
  if (Date.now() - throttleTime < THROTTLE_TTL && throttleCache.length > 0) {
    return { items: throttleCache, source: throttleSource || "金十数据" };
  }

  // 并发去重：已有刷新在跑就等它
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const [jin10Items, wscnItems] = await Promise.all([
      fetchJin10(),
      fetchWallstreetCN(),
    ]);

    // 金十为主源，华尔街见闻全量合并（金十CDN缓存4小时会导致午间延迟17分钟，靠去重处理重叠）
    let all: FlashItem[] = [...jin10Items, ...wscnItems];

    // 质量过滤 + 英文过滤（金十会推英文原文，同一条新闻通常有中文版）
    const filtered = all.filter((i) => !isLowQuality(i.content) && !isEnglishDominant(i.content_text));

    // 跨源去重（lib/flash-filter 单源维护）
    const deduped = dedupFlashItems(filtered);
    const items = deduped.slice(0, 30);

    if (items.length === 0) {
      // 5分钟兜底（source带缓存标注，口径与原flash route一致）
      if (Date.now() - lastSuccessTime < CACHE_TTL && lastSuccessCache.length > 0) {
        return { items: lastSuccessCache, source: "缓存数据（数据源暂时不可用）" };
      }
      return { items: [], source: "" };
    }

    // 写节流缓存+兜底缓存
    throttleCache = items;
    throttleTime = Date.now();
    lastSuccessCache = items;
    lastSuccessTime = Date.now();

    const sources: string[] = [];
    if (jin10Items.length > 0) sources.push("金十数据");
    if (wscnItems.some((i) => i.timestamp > (jin10Items[0]?.timestamp || 0))) sources.push("华尔街见闻");
    throttleSource = sources.join("+") || "金十数据";

    return { items, source: throttleSource };
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export { formatRelativeTime };
