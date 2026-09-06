import { NextResponse } from "next/server";
import { getFlashFeed, type FlashItem } from "@/lib/flash-source";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 数据抓取/过滤/去重/缓存逻辑已抽至 lib/flash-source.ts（9/6：chat实时讯息注入共用数据源与缓存）
// 本route只保留：限流 + 响应组装 + 数据源不可用时的503语义

export async function GET(request: Request) {
  const limited = await enforceRateLimitAsync(request, "flash", RATE_LIMITS.flash);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const feed = await getFlashFeed();
  const items: FlashItem[] = feed.items;

  if (items.length === 0) {
    return NextResponse.json(
      { error: "快讯数据暂时不可用，请稍后重试" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    data: items,
    timestamp: new Date().toISOString(),
    source: feed.source || "金十数据",
  });
}
