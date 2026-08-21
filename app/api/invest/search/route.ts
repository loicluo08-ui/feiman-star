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
 * 美股搜索代理（Finnhub search，Yahoo兜底）
 * GET /api/invest/search?q=apple
 */

// Yahoo搜索兜底（Finnhub search产线异常时）
async function yahooSearchFallback(q: string): Promise<Array<{ code: string; name: string; exchange: string | null; type: string }>> {
  const browserHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
  };
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
      { headers: browserHeaders, signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; exchDisp?: string; quoteType?: string }> };
    return (data.quotes ?? [])
      .filter((it) => it.symbol && /^[A-Z]{1,5}(\.[A-Z])?$/.test(it.symbol) && (!it.exchDisp || ["NASDAQ", "NYSE", "NYSE American", "NMS", "NYQ", "NGM"].includes(it.exchDisp)))
      .slice(0, 8)
      .map((it) => ({
        code: it.symbol as string,
        name: it.shortname || it.longname || (it.symbol as string),
        exchange: it.exchDisp ?? null,
        type: it.quoteType === "ETF" ? "ETF" : "EQUITY",
      }));
  } catch {
    return [];
  }
}

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

    if (filtered.length === 0) {
      // Finnhub search产线异常恒空 → Yahoo兜底
      const yahooResults = await yahooSearchFallback(q);
      return NextResponse.json({ data: yahooResults });
    }

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
