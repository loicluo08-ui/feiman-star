import { NextRequest, NextResponse } from "next/server";
import { getQtStocks } from "@/lib/qt";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
const YAHOO_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 30秒内存缓存，避免频繁请求腾讯+Yahoo+Finnhub
let cache: { data: unknown; expiresAt: number } | null = null;
const CACHE_TTL = 30_000;

// 日线缓存：板块5d/20d一天只变一次，60分钟TTL把16个ETF的Yahoo请求压到每小时16个
const closesCache = new Map<string, { closes: number[]; expiresAt: number }>();

async function fetchYahooCloses(symbol: string): Promise<number[]> {
  const cached = closesCache.get(symbol);
  if (cached && cached.expiresAt > Date.now() && cached.closes.length > 0) {
    return cached.closes;
  }
  const result = await fetchYahooClosesUncached(symbol);
  if (result.length > 0) {
    closesCache.set(symbol, { closes: result, expiresAt: Date.now() + 60 * 60 * 1000 });
  }
  return result;
}

async function fetchYahooClosesUncached(symbol: string): Promise<number[]> {
  // query2优先+完整浏览器headers（stock route同款已验证配置；query1裸请求会被限）
  const browserHeaders: Record<string, string> = {
    "User-Agent": YAHOO_UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Referer": "https://finance.yahoo.com/",
  };
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${symbol}?interval=1d&range=3mo`, {
        headers: browserHeaders,
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
      };
      const closes = (payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
        .filter((value): value is number => typeof value === "number" && value > 0);
      if (closes.length > 0) return closes;
    } catch {
      // 换下一个host
    }
  }
  return [];
}

/**
 * 市场脉搏：大盘指数+板块ETF+波动率
 * GET /api/invest/market-pulse
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "marketPulse", RATE_LIMITS.marketPulse);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  // 检查缓存
  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json(
      { data: cache.data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const indices = [
      { symbol: "SPY", name: "标普500" },
      { symbol: "QQQ", name: "纳斯达克100" },
      { symbol: "DIA", name: "道琼斯" },
      { symbol: "IWM", name: "罗素2000（小盘）" },
      { symbol: "UVXY", name: "波动率（恐慌指数代理）" },
    ];

    const sectors = [
      { symbol: "XLK", name: "科技" },
      { symbol: "XLF", name: "金融" },
      { symbol: "XLE", name: "能源" },
      { symbol: "XLV", name: "医疗" },
      { symbol: "XLY", name: "可选消费" },
      { symbol: "XLP", name: "必需消费" },
      { symbol: "XLI", name: "工业" },
      { symbol: "XLU", name: "公用事业" },
      { symbol: "XLRE", name: "房地产" },
      { symbol: "XLB", name: "材料" },
      { symbol: "XLC", name: "通信服务" },
    ];

    // 动态symbols（若有）
    const requestedSymbols = (new URL(request.url).searchParams.get("symbols") ?? "")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol, index, symbols) => /^[A-Z]{1,6}$/.test(symbol) && symbols.indexOf(symbol) === index)
      .slice(0, 20);

    // 腾讯批量源：一次请求拿全部实时行情（免认证），失败则全走Finnhub
    const qtAllSymbols = [...requestedSymbols, ...indices.map((i) => i.symbol), ...sectors.map((s) => s.symbol)];
    const qtMap = await getQtStocks(qtAllSymbols);

    const fetchQuote = async (symbol: string) => {
      const q = qtMap.get(symbol);
      if (q && q.price != null) {
        return { price: q.price, change: q.change, changePct: q.changePct };
      }
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (!res.ok) return null;
      const d = await res.json();
      if (!d || d.c === 0) return null;
      return {
        price: d.c,
        change: d.d,
        changePct: d.dp,
      };
    };

    const fetchMultiPeriodChange = async (symbol: string, currentPrice: number | null) => {
      if (currentPrice == null) return { changePct5d: null, changePct20d: null };
      // Finnhub candle免费版已停（403），直接走Yahoo query2（stock route同款配置）
      const closes = await fetchYahooCloses(symbol);
      const close5d = closes.length >= 6 ? closes[closes.length - 6] : null;
      const close20d = closes.length >= 21 ? closes[closes.length - 21] : null;
      return {
        changePct5d: close5d ? ((currentPrice - close5d) / close5d) * 100 : null,
        changePct20d: close20d ? ((currentPrice - close20d) / close20d) * 100 : null,
      };
    };

    if (requestedSymbols.length > 0) {
            // 分批拉取：Yahoo对16并发限流(429全灭)，每批4个+批间300ms
      const quotes: Array<{ symbol: string; price: number | null; change: number | null; changePct: number | null; changePct5d: number | null; changePct20d: number | null; name?: string }> = [];
      for (let i = 0; i < requestedSymbols.length; i += 4) {
        const batch = requestedSymbols.slice(i, i + 4);
        const batchResults = await Promise.all(batch.map(async (symbol) => {
          const quote = await fetchQuote(symbol);
          const multiPeriod = await fetchMultiPeriodChange(symbol, quote?.price ?? null);
          return {
            symbol,
            price: quote?.price ?? null,
            change: quote?.change ?? null,
            changePct: quote?.changePct ?? null,
            changePct5d: multiPeriod.changePct5d,
            changePct20d: multiPeriod.changePct20d,
          };
        }));
        quotes.push(...batchResults);
        if (i + 4 < requestedSymbols.length) await new Promise(r => setTimeout(r, 300));
      }

      return NextResponse.json(
        { data: { quotes, timestamp: new Date().toISOString() } },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const [indexData, sectorData] = await Promise.all([
      Promise.all(indices.map(async (idx) => {
        const q = await fetchQuote(idx.symbol);
        return { ...idx, ...q };
      })),
      // 板块分批拉取：11个ETF并发Yahoo必限流（429全灭），4个/批+300ms间隔
      (async () => {
        const results: Array<Record<string, unknown>> = [];
        for (let i = 0; i < sectors.length; i += 4) {
          const batch = sectors.slice(i, i + 4);
          const batchResults = await Promise.all(batch.map(async (sec) => {
            const q = await fetchQuote(sec.symbol);
            const multiPeriod = await fetchMultiPeriodChange(sec.symbol, q?.price ?? null);
            return { ...sec, ...q, ...multiPeriod };
          }));
          results.push(...batchResults);
          if (i + 4 < sectors.length) await new Promise(r => setTimeout(r, 300));
        }
        return results;
      })(),
    ]);

    // 判断市场情绪
    const spy = indexData.find((i) => i.symbol === "SPY");
    const uvxy = indexData.find((i) => i.symbol === "UVXY");
    let sentiment = "中性";
    if (spy && uvxy) {
      if (spy.changePct != null && spy.changePct > 1 && uvxy.price < 20) sentiment = "偏乐观";
      else if (spy.changePct != null && spy.changePct < -1 || uvxy.price > 25) sentiment = "偏悲观";
      else if (uvxy.price > 30) sentiment = "恐慌";
    }

    // 找最强/最弱板块
    const validSectors = sectorData.filter((s) => s.changePct != null);
    const strongest = validSectors.length > 0
      ? [...validSectors].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))[0]
      : null;
    const weakest = validSectors.length > 0
      ? [...validSectors].sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0))[0]
      : null;

    const responseData = {
        indices: indexData,
        sectors: sectorData,
        sentiment,
        strongestSector: strongest ? `${strongest.name} (${strongest.changePct?.toFixed(2)}%)` : null,
        weakestSector: weakest ? `${weakest.name} (${weakest.changePct?.toFixed(2)}%)` : null,
        timestamp: new Date().toISOString(),
    };

    // 写入缓存
    cache = { data: responseData, expiresAt: Date.now() + CACHE_TTL };

    return NextResponse.json({
      data: responseData,
    });
  } catch (error) {
    console.error("[market-pulse]", error);
    return NextResponse.json({ data: null });
  }
}
