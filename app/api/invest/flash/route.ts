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
// 护城河1: 工具函数
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
  return /<b>|<strong>/.test(html);
}

function parseTime(timeStr: string): number {
  const d = new Date(timeStr.replace(" ", "T") + "+08:00");
  return Math.floor(d.getTime() / 1000);
}

function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 10) return "刚刚";
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return new Date(timestamp * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 护城河2: 内容清洗 — 过滤广告/评论/低质量快讯
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SPAM_KEYWORDS = [
  "扫码进群", "加微信", "限时优惠", "点击领取",
  "免费领取", "注册即送", "邀请好友",
];

const COMMENT_KEYWORDS = [
  "笔者认为", "笔者认为", "我们认为", "分析师认为",
];

function isSpam(content: string): boolean {
  const lower = content.toLowerCase();
  return SPAM_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

function isComment(content: string): boolean {
  return COMMENT_KEYWORDS.some((kw) => content.includes(kw));
}

function isLowQuality(item: FlashItem): boolean {
  // 内容太短（<10字符）且非重要
  if (item.content.length < 10 && !item.is_important) return true;
  // 广告
  if (isSpam(item.content)) return true;
  // 评论文章混入快讯
  if (isComment(item.content)) return true;
  // 未来时间（数据异常）
  if (item.timestamp > Math.floor(Date.now() / 1000) + 60) return true;
  // 太旧（>48小时）
  if (item.timestamp < Math.floor(Date.now() / 1000) - 48 * 3600) return true;
  return false;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 护城河3: 指纹去重 — 内容相似度去重（不只看前30字符）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function contentFingerprint(content: string): string {
  // 去标点/空格/数字后取前20字符做指纹
  const cleaned = content
    .replace(/[\s\u3000\p{P}0-9a-zA-Z]/gu, "")
    .slice(0, 20);
  return cleaned;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 护城河4: 数据源 — 金十
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface Jin10Item {
  id: string;
  time: string;
  type: number;
  data: {
    title: string | null;
    content: string;
    exclusive_to?: string[];
  };
  important: number;
  tags: string[];
  channel: number[];
  remark: string[];
}

async function fetchJin10(): Promise<FlashItem[]> {
  try {
    const res = await fetch("https://www.jin10.com/flash_newest.js", {
      headers: {
        "User-Agent": UA,
        Referer: "https://www.jin10.com/",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];

    const text = await res.text();
    const jsonStr = text.replace("var newest = ", "").trim().replace(/;$/, "");
    const data = JSON.parse(jsonStr) as Jin10Item[];

    return data.map((item) => {
      const title = item.data.title || "";
      const content = item.data.content || "";
      const cleanContent = stripHtml(content);
      const cleanTitle = stripHtml(title);
      const ts = parseTime(item.time);

      return {
        id: item.id,
        title: cleanTitle,
        content: cleanContent,
        content_text: cleanTitle ? `${cleanTitle}\n${cleanContent}` : cleanContent,
        time_str: formatRelativeTime(ts),
        timestamp: ts,
        is_important: item.important === 1 || hasBoldTag(content),
        channels: item.channel || [],
        source: "金十数据",
      };
    });
  } catch {
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 护城河4: 数据源 — 华尔街见闻
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface WscnItem {
  id: string;
  title: string;
  content: string;
  content_text: string;
  display_time: number;
  channels: Array<{ name: string }>;
  is_important: boolean;
  symbols?: Array<{ code: string }>;
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
// 护城河4: 数据源 — 财联社（第三源兜底）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchCLS(): Promise<FlashItem[]> {
  try {
    const res = await fetch(
      "https://www.cls.cn/api/sw?app=CailianpressWeb&os=web&sv=8.4.6",
      {
        headers: {
          "User-Agent": UA,
          Referer: "https://www.cls.cn/",
        },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return [];

    const payload = (await res.json()) as {
      data?: {
        roll_data?: Array<{
          id: string;
          ctime: number;
          title: string;
          content: string;
          is_important: boolean;
        }>;
      };
    };
    const items = payload.data?.roll_data ?? [];

    return items.slice(0, 20).map((item) => {
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
// 护城河5: 静态兜底 — 所有源全挂时返回缓存或静态数据
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Vercel多实例不共享内存，但单实例内可以用作最后兜底
let lastSuccessCache: FlashItem[] = [];
let lastSuccessTime = 0;

function getCachedFallback(): FlashItem[] {
  // 缓存5分钟内有效
  if (lastSuccessCache.length > 0 && Date.now() - lastSuccessTime < 5 * 60 * 1000) {
    return lastSuccessCache.map((item) => ({
      ...item,
      time_str: formatRelativeTime(item.timestamp),
      source: `${item.source}（缓存）`,
    }));
  }
  return [];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主处理：三源并行 + 清洗 + 去重 + 排序 + 兜底
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** GET /api/invest/flash - 实时财经快讯（三源合并+多层护城河） */
export async function GET() {
  // 三源并行拉取
  const [wscnItems, jin10Items, clsItems] = await Promise.all([
    fetchWallstreetCN(),
    fetchJin10(),
    fetchCLS(),
  ]);

  // 合并
  const all = [...wscnItems, ...jin10Items, ...clsItems];

  // 护城河2: 过滤低质量
  const filtered = all.filter((item) => !isLowQuality(item));

  // 护城河3: 指纹去重
  const seen = new Set<string>();
  const deduped: FlashItem[] = [];
  for (const item of filtered.sort((a, b) => b.timestamp - a.timestamp)) {
    const fp = contentFingerprint(item.content);
    if (seen.has(fp)) continue;
    seen.add(fp);
    deduped.push(item);
  }

  let items = deduped.slice(0, 30);

  // 护城河5: 全挂时用缓存兜底
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

  // 统计源
  const sources: string[] = [];
  if (wscnItems.length > 0) sources.push("华尔街见闻");
  if (jin10Items.length > 0) sources.push("金十数据");
  if (clsItems.length > 0) sources.push("财联社");

  return NextResponse.json({
    data: items,
    timestamp: new Date().toISOString(),
    source: sources.join("+") || "未知",
    stats: {
      total: items.length,
      wscn: wscnItems.length,
      jin10: jin10Items.length,
      cls: clsItems.length,
      filtered: all.length - filtered.length,
      deduped: filtered.length - deduped.length,
    },
  });
}
