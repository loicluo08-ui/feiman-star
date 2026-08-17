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

// 内存缓存 30秒
let cache: { data: FlashItem[]; ts: number } | null = null;
const CACHE_TTL = 30_000;

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseTime(timeStr: string): number {
  // "2026-08-17 22:34:25" -> unix timestamp
  const d = new Date(timeStr.replace(" ", "T") + "+08:00");
  return Math.floor(d.getTime() / 1000);
}

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

/** 金十数据实时快讯 */
async function fetchJin10(): Promise<FlashItem[]> {
  try {
    const res = await fetch("https://www.jin10.com/flash_newest.js", {
      headers: {
        "User-Agent": UA,
        "Referer": "https://www.jin10.com/",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const text = await res.text();
    // 格式: var newest = [...]
    const jsonStr = text.replace("var newest = ", "").trim().replace(/;$/, "");
    const data = JSON.parse(jsonStr) as Jin10Item[];

    return data.map((item) => {
      const title = item.data.title || "";
      const content = item.data.content || "";
      const cleanContent = stripHtml(content);
      const cleanTitle = stripHtml(title);

      return {
        id: item.id,
        title: cleanTitle,
        content: cleanContent,
        content_text: cleanTitle ? `${cleanTitle}\n${cleanContent}` : cleanContent,
        time_str: item.time,
        timestamp: parseTime(item.time),
        is_important: item.important === 1,
        channels: item.channel || [],
        source: "金十数据",
      };
    });
  } catch {
    return [];
  }
}

/** 华尔街见闻快讯（备用源） */
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
      return {
        id: `wscn_${item.id}`,
        title: cleanTitle,
        content: cleanContent,
        content_text: cleanTitle ? `${cleanTitle}\n${cleanContent}` : cleanContent,
        time_str: new Date(item.display_time * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
        timestamp: item.display_time,
        is_important: false,
        channels: [],
        source: "华尔街见闻",
      };
    });
  } catch {
    return [];
  }
}

/** GET /api/invest/flash - 实时财经快讯（金十数据为主，华尔街见闻兜底） */
export async function GET() {
  // 检查缓存
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json({
      data: cache.data,
      timestamp: new Date().toISOString(),
      source: "金十数据",
      cached: true,
    });
  }

  // 先拉金十
  let items = await fetchJin10();

  // 金十失败则拉华尔街见闻
  if (items.length === 0) {
    items = await fetchWallstreetCN();
  }

  if (items.length === 0) {
    if (cache) {
      return NextResponse.json({
        data: cache.data,
        timestamp: new Date().toISOString(),
        source: "缓存",
        cached: true,
      });
    }
    return NextResponse.json(
      { error: "快讯数据暂时不可用，请稍后重试" },
      { status: 503 },
    );
  }

  cache = { data: items, ts: Date.now() };

  return NextResponse.json({
    data: items,
    timestamp: new Date().toISOString(),
    source: items[0]?.source || "金十数据",
  });
}
