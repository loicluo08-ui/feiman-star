import { NextResponse } from "next/server";

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 工具函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

// 内容质量过滤
function isLowQuality(content: string): boolean {
  if (!content || content.length < 5) return true;
  // 广告/推广
  if (/扫码|进群|加微信|限时|优惠|点击链接|注册即送/.test(content)) return true;
  // 分析评论（不是快讯）
  if (/笔者认为|我们认为|分析师表示|建议关注/.test(content)) return true;
  return false;
}

// 时间异常过滤
function isTimeAbnormal(ts: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  // 未来时间（数据错误）
  if (ts > now + 60) return true;
  // 超过48小时（太旧）
  if (ts < now - 48 * 3600) return true;
  return false;
}

// 指纹去重（去掉标点空格后取前20字符）
function makeFingerprint(content: string): string {
  return content
    .replace(/[\s\p{P}]/gu, "")
    .slice(0, 20)
    .toLowerCase();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源1: 金十数据（主源）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface Jin10Raw {
  id: string;
  time: string;
  type: number;
  data: { content: string; title: string; source: string };
  important: number;
  channel: number[];
}

async function fetchJin10(): Promise<FlashItem[]> {
  // 护城河1: cache-buster绕CDN缓存（延迟从6-9分钟降到2-3分钟）
  // 护城河2: 双域名容灾（主域名挂了用备用域名）
  // 护城河3: 超时重试（第一次5s超时，第二次3s超时）
  // 护城河4: 实时API（get_flash_list）作为第二梯队，需要x-app-id header

  const cacheBuster = Date.now();
  const endpoints = [
    {
      url: `https://www.jin10.com/flash_newest.js?_=${cacheBuster}`,
      headers: {
        "User-Agent": UA,
        Referer: "https://www.jin10.com/",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
      timeout: 5000,
      parser: "newest" as const,
    },
    {
      url: `https://flash-api.jin10.com/get_flash_list?max_time=${new Date().toISOString().slice(0, 19).replace("T", "+")}&channel=-8200`,
      headers: {
        "User-Agent": UA,
        Referer: "https://www.jin10.com/",
        "x-app-id": "bVBF4FyRTn5NJF5n",
        "Accept": "application/json",
      },
      timeout: 5000,
      parser: "api" as const,
    },
    {
      url: `https://www.jin10.com/flash_newest.js`,
      headers: {
        "User-Agent": UA,
        Referer: "https://www.jin10.com/",
      },
      timeout: 3000,
      parser: "newest" as const,
    },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        headers: ep.headers,
        signal: AbortSignal.timeout(ep.timeout),
      });
      if (!res.ok) continue;

      const text = await res.text();
      if (!text || text.length < 10) continue;

      if (ep.parser === "newest") {
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
      } else {
        // API parser
        const raw = JSON.parse(text) as Array<{
          id: string;
          time: string;
          data: { content: string; title: string; source: string };
          important: number;
          channel: number[];
        }>;

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
      }
    } catch {
      // 这个endpoint失败，试下一个
      continue;
    }
  }

  return [];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源2: 华尔街见闻（补充金十延迟期内的最新快讯）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface WscnItem {
  id: string;
  title: string;
  content: string;
  content_text: string;
  display_time: number;
  is_important: boolean;
}

async function fetchWallstreetCN(): Promise<FlashItem[]> {
  try {
    const res = await fetch(
      "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=20",
      {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];

    const payload = (await res.json()) as {
      data?: { items?: WscnItem[] };
    };
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
// 数据源3: 财联社（第三兜底）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchCLS(): Promise<FlashItem[]> {
  try {
    const res = await fetch(
      "https://www.cls.cn/nodeapi/updateTelegraphList?app=CailianpressWeb&category=&lastTime=&os=web&sv=8.4.6",
      {
        headers: {
          "User-Agent": UA,
          Referer: "https://www.cls.cn/",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];

    const payload = (await res.json()) as {
      data?: { roll_data?: Array<{ id: string; ctime: number; title: string; content: string; is_important: boolean; subject: string[] }> };
    };
    const items = payload.data?.roll_data ?? [];

    return items.map((item) => {
      const cleanContent = stripHtml(item.content || "");
      const cleanTitle = stripHtml(item.title || "");
      const ts = item.ctime;

      return {
        id: `cls_${item.id}`,
        title: cleanTitle,
        content: cleanContent,
        content_text: cleanTitle ? `${cleanTitle}\n${cleanContent}` : cleanContent,
        time_str: formatRelativeTime(ts),
        timestamp: ts,
        is_important: item.is_important || false,
        channels: [],
        source: "财联社",
      };
    });
  } catch {
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 缓存兜底（Vercel单实例内存，5分钟有效）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let lastSuccessCache: FlashItem[] = [];
let lastSuccessTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

function getCachedFallback(): FlashItem[] {
  if (Date.now() - lastSuccessTime > CACHE_TTL) return [];
  return lastSuccessCache;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主逻辑：金十优先，其他源补充
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** GET /api/invest/flash - 实时财经快讯（金十优先，多源补充） */
export async function GET() {
  // 并行拉三个源
  const [jin10Items, wscnItems, clsItems] = await Promise.all([
    fetchJin10(),
    fetchWallstreetCN(),
    fetchCLS(),
  ]);

  // 找到金十最新的timestamp
  const jin10Latest = jin10Items.length > 0
    ? Math.max(...jin10Items.map((i) => i.timestamp))
    : 0;

  // 华尔街见闻只取金十还没有的（timestamp > 金十最新）
  const wscnSupplement = wscnItems.filter((i) => i.timestamp > jin10Latest);

  // 财联社也只取金十还没有的
  const clsSupplement = clsItems.filter((i) => i.timestamp > jin10Latest);

  // 合并：金十全部 + 其他源补充
  const all = [...jin10Items, ...wscnSupplement, ...clsSupplement];

  // 质量过滤
  const filtered = all.filter(
    (item) =>
      !isLowQuality(item.content) &&
      !isTimeAbnormal(item.timestamp),
  );

  // 指纹去重
  const seen = new Map<string, number>();
  const deduped: FlashItem[] = [];
  for (const item of filtered.sort((a, b) => b.timestamp - a.timestamp)) {
    const fp = makeFingerprint(item.content);
    if (seen.has(fp)) continue;
    seen.set(fp, item.timestamp);
    deduped.push(item);
  }

  const items = deduped.slice(0, 30);

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

  // 更新缓存
  lastSuccessCache = items;
  lastSuccessTime = Date.now();

  // 统计
  const sources: string[] = [];
  if (jin10Items.length > 0) sources.push("金十数据");
  if (wscnSupplement.length > 0) sources.push("华尔街见闻");
  if (clsSupplement.length > 0) sources.push("财联社");

  return NextResponse.json({
    data: items,
    timestamp: new Date().toISOString(),
    source: sources.join("+") || "金十数据",
    stats: {
      total: items.length,
      jin10: jin10Items.filter((i) => !isLowQuality(i.content)).length,
      wscn_supplement: wscnSupplement.filter((i) => !isLowQuality(i.content)).length,
      cls_supplement: clsSupplement.filter((i) => !isLowQuality(i.content)).length,
      filtered: all.length - filtered.length,
      deduped: filtered.length - deduped.length,
    },
  });
}
