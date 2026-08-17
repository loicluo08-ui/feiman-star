import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FlashItem {
  id: string;
  title: string;
  content: string;
  content_text: string;
  time: number;
  time_str: string;
  channels: string[];
  is_important: boolean;
  symbols?: string[];
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 内存缓存 30秒
let cache: { data: FlashItem[]; ts: number } | null = null;
const CACHE_TTL = 30_000;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function fetchWallstreetCN(): Promise<FlashItem[]> {
  const channels = [
    { key: "global-channel", label: "全球" },
    { key: "a-stock-channel", label: "A股" },
  ];

  const results = await Promise.all(
    channels.map(async ({ key, label }) => {
      try {
        const res = await fetch(
          `https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=${key}&limit=20`,
          {
            headers: { "User-Agent": UA },
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!res.ok) return [];
        const data = await res.json() as { data?: { items?: unknown[] } };
        const items = data?.data?.items ?? [];
        return items.map((raw) => {
          const item = raw as Record<string, unknown>;
          const content = String(item.content || "");
          const contentText = stripHtml(content);
          return {
            id: String(item.id || ""),
            title: String(item.title || "").trim() || contentText.slice(0, 30),
            content,
            content_text: contentText,
            time: Number(item.display_time || 0),
            time_str: formatTime(Number(item.display_time || 0)),
            channels: [label],
            is_important: contentText.includes("重磅") || contentText.includes("重要") || contentText.includes("突发"),
            symbols: Array.isArray(item.symbols) ? (item.symbols as Array<{ code?: string }>).map((s) => s.code || "").filter(Boolean) : undefined,
          } as FlashItem;
        });
      } catch {
        return [];
      }
    }),
  );

  const seen = new Set<string>();
  const merged: FlashItem[] = [];
  for (const list of results) {
    for (const item of list) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
  }
  merged.sort((a, b) => b.time - a.time);
  return merged.slice(0, 40);
}

/** GET /api/invest/flash - 实时财经快讯 */
export async function GET() {
  // 检查缓存
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json({
      data: cache.data,
      timestamp: new Date().toISOString(),
      source: "华尔街见闻",
      cached: true,
    });
  }

  const items = await fetchWallstreetCN();

  if (items.length === 0) {
    // 有旧缓存就返回旧的
    if (cache) {
      return NextResponse.json({
        data: cache.data,
        timestamp: new Date().toISOString(),
        source: "华尔街见闻",
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
    source: "华尔街见闻",
  });
}
