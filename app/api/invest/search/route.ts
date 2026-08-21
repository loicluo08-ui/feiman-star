import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PROFILE_CACHE_TTL = 6 * 60 * 60 * 1000;
const profileCache = new Map<string, { industry: string; expiresAt: number }>();

async function getIndustry(symbol: string, token: string): Promise<string> {
  const cached = profileCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.industry;

  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`,
      { signal: AbortSignal.timeout(3500) },
    );
    if (!response.ok) return "行业未知";
    const profile = (await response.json()) as { finnhubIndustry?: string };
    const industry = profile.finnhubIndustry?.trim() || "行业未知";
    profileCache.set(symbol, { industry, expiresAt: Date.now() + PROFILE_CACHE_TTL });
    return industry;
  } catch {
    return "行业未知";
  }
}

/**
 * 美股搜索代理（Yahoo Finance search）
 * GET /api/invest/search?q=apple
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "search", RATE_LIMITS.search);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 1) {
    return NextResponse.json({ data: [] });
  }

  try {
    const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
    if (!FINNHUB_KEY) {
      return NextResponse.json({ data: [] });
    }

    const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return NextResponse.json({ data: [] });

    const json = await res.json();
    const results: Array<Record<string, unknown>> = json.result ?? [];

    const filtered = results
      .filter((r) => {
        const sym = r.symbol as string;
        // 只保留美股代码（纯字母，不含点）
        return /^[A-Z]{1,6}$/.test(sym);
      })
      .map((r) => ({
        code: r.symbol as string,
        name: (r.description ?? r.symbol) as string,
        exchange: null,
        type: "EQUITY",
      }))
      .slice(0, 12);

    const enriched = await Promise.all(
      filtered.map(async (result) => ({
        ...result,
        industry: await getIndustry(result.code, FINNHUB_KEY),
      })),
    );

    return NextResponse.json({ data: enriched });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/search] ${message}`);
    return NextResponse.json({ data: [] });
  }
}
