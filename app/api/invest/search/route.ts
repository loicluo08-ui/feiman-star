import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { saSearch } from "@/lib/stockanalysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PROFILE_CACHE_TTL = 6 * 60 * 60 * 1000;
const profileCache = new Map<string, { industry: string; expiresAt: number }>();

// 搜索结果缓存：Finnhub免费层60次/分是硬配额，同一query 10分钟内直接回缓存
// 大量使用场景下重复搜索占比高，缓存把上游压力压到近零
const searchCache = new Map<string, { data: unknown; expiresAt: number }>();
const SEARCH_CACHE_TTL = 10 * 60 * 1000;

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
        industry: "行业未知",
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

  // 结果缓存命中（key=归一化query，大小写不敏感）
  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ data: cached.data, cached: true });
  }

  // 所有返回路径统一写缓存（含兜底结果——上游故障期间缓存兜底数据，10分钟后自动恢复探测）
  const respondWithCache = (data: unknown) => {
    searchCache.set(cacheKey, { data, expiresAt: Date.now() + SEARCH_CACHE_TTL });
    return NextResponse.json({ data });
  };

  try {
    const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

    // Finnhub主源（任何失败形态：无key/HTTP错误/超时/空结果 → 全部落到Yahoo兜底）
    let filtered: Array<{ code: string; name: string; exchange: string | null; type: string }> = [];
    if (FINNHUB_KEY) {
      try {
        const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const json = await res.json();
          const results: Array<Record<string, unknown>> = json.result ?? [];
          filtered = results
            .filter((r) => {
              const sym = r.symbol as string;
              // 只保留美股代码（含BRK.A类带点）
              return /^[A-Z]{1,5}(\.[A-Z])?$/.test(sym);
            })
            .map((r) => ({
              code: r.symbol as string,
              name: (r.description ?? r.symbol) as string,
              exchange: null,
              type: "EQUITY",
            }))
            .slice(0, 12);
        }
      } catch {}
    }

    if (filtered.length === 0) {
      // Finnhub失败/空 → Yahoo兜底 → 2026-08-23：Yahoo被Vercel IP限流429，加stockanalysis最终兜底
      const yahooResults = await yahooSearchFallback(q);
      if (yahooResults.length > 0) {
        return respondWithCache(yahooResults);
      }
      const saResults = await saSearch(q);
      return respondWithCache(saResults.map((r) => ({
        ...r,
        type: r.type === "etf" ? "ETF" : "EQUITY",
        industry: "行业未知",
      })));
    }

    const enriched = await Promise.all(
      filtered.map(async (result) => ({
        ...result,
        industry: await getIndustry(result.code, FINNHUB_KEY),
      })),
    );

    return respondWithCache(enriched);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/search] ${message}`);
    // 兜底链最后一道：整体异常也尝试Yahoo → SA
    const yahooResults = await yahooSearchFallback(q).catch(() => []);
    if (yahooResults.length > 0) {
      return respondWithCache(yahooResults);
    }
    const saResults = await saSearch(q).catch(() => []);
    return respondWithCache(saResults.map((r) => ({
      ...r,
      type: r.type === "etf" ? "ETF" : "EQUITY",
      industry: "行业未知",
    })));
  }
}
