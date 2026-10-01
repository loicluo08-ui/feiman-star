import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { runHealthCheck } from "@/lib/health-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 数据源健康检查（10/1外部评审v1.2采纳 P0-3）
 * GET /api/invest/health → 六源状态（四真探+三配置态）+ 数据时效
 * 60s内存缓存在lib/health-check内，本route只加限流与HTTP缓存语义
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "search", RATE_LIMITS.search);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const result = await runHealthCheck();
  return NextResponse.json(result, {
    // 降级态不缓存，正常态边缘缓存30s（巡检轮询友好）
    headers: {
      "Cache-Control":
        result.status === "ok"
          ? "public, s-maxage=30, stale-while-revalidate=60"
          : "no-store",
    },
  });
}
