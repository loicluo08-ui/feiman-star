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

// Vercel serverless多实例不共享内存缓存，直接每次拉取金十
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

// 检测是否含<b>或<strong>标签（金十用加粗表示重要内容）
function hasBoldTag(html: string): boolean {
  return /<b>|<strong>/.test(html);
}

function parseTime(timeStr: string): number {
  // "2026-08-17 22:34:25" -> unix timestamp
  const d = new Date(timeStr.replace(" ", "T") + "+08:00");
  return Math.floor(d.getTime() / 1000);
}

function formatRelativeTime(timeStr: string): string {
  const ts = parseTime(timeStr);
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 10) return "刚刚";
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return timeStr;
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
      signal: AbortSignal.timeout(4000),
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
        time_str: formatRelativeTime(item.time),
        timestamp: parseTime(item.time),
        is_important: item.important === 1 || hasBoldTag(content),
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
      const ts = item.display_time;
      // 相对时间
      const now = Math.floor(Date.now() / 1000);
      const diff = now - ts;
      let timeStr: string;
      if (diff < 10) timeStr = "刚刚";
      else if (diff < 60) timeStr = `${diff}秒前`;
      else if (diff < 3600) timeStr = `${Math.floor(diff / 60)}分钟前`;
      else if (diff < 86400) timeStr = `${Math.floor(diff / 3600)}小时前`;
      else timeStr = new Date(ts * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

      return {
        id: `wscn_${item.id}`,
        title: cleanTitle,
        content: cleanContent,
        content_text: cleanTitle ? `${cleanTitle}\n${cleanContent}` : cleanContent,
        time_str: timeStr,
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

/** GET /api/invest/flash - 实时财经快讯（华尔街见闻为主，金十兜底） */
export async function GET() {
  // 华尔街见闻API实时性好，金十flash_newest.js有缓存延迟
  let items = await fetchWallstreetCN();

  // 华尔街见闻失败则拉金十
  if (items.length === 0) {
    items = await fetchJin10();
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: "快讯数据暂时不可用，请稍后重试" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    data: items,
    timestamp: new Date().toISOString(),
    source: items[0]?.source || "华尔街见闻",
  });
}
