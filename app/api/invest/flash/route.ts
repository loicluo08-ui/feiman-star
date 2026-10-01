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
  const raw: FlashItem[] = feed.items;
  // 契约兜底（9/30诊断P2-1）：金十短讯常无标题，空title统一降级为content截断，保证API契约非空
  const items: FlashItem[] = raw.map((it) => {
    const t = (it.title || "").trim();
    if (t) return it;
    const body = ((it.content_text || it.content || "").replace(/\s+/g, " ")).trim();
    return { ...it, title: body.slice(0, 42) + (body.length > 42 ? "…" : "") };
  });

  if (items.length === 0) {
    return NextResponse.json(
      { error: "快讯数据暂时不可用，请稍后重试" },
      { status: 503 },
    );
  }

  // 10/1外部评审v1.2采纳：边缘缓存——快讯源内部已有5分钟缓存+10s节流，45s边缘新鲜度不影响时效
  return NextResponse.json(
    {
      data: items,
      timestamp: new Date().toISOString(),
      source: feed.source || "金十数据",
    },
    { headers: { "Cache-Control": "public, s-maxage=45, stale-while-revalidate=120" } },
  );
}
