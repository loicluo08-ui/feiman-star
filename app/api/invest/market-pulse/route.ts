import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "d9ve1m9r01qv408k7rf0d9ve1m9r01qv408k7rfg";
const YAHOO_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
let yahooSessionPromise: Promise<{ cookie: string; crumb: string }> | null = null;

function getYahooSession() {
  if (yahooSessionPromise) return yahooSessionPromise;
  yahooSessionPromise = (async () => {
    try {
      const cookieResponse = await fetch("https://fc.yahoo.com/", {
        headers: { "User-Agent": YAHOO_UA },
        redirect: "manual",
        signal: AbortSignal.timeout(4000),
      });
      const match = (cookieResponse.headers.get("set-cookie") || "").match(/A3=([^;]+)/);
      const cookie = match?.[1] ?? "";
      if (!cookie) return { cookie: "", crumb: "" };
      const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
        headers: { "User-Agent": YAHOO_UA, Cookie: `A3=${cookie}` },
        signal: AbortSignal.timeout(4000),
      });
      return { cookie, crumb: crumbResponse.ok ? (await crumbResponse.text()).trim() : "" };
    } catch {
      return { cookie: "", crumb: "" };
    }
  })();
  return yahooSessionPromise;
}

async function fetchYahooCloses(symbol: string): Promise<number[]> {
  try {
    const { cookie, crumb } = await getYahooSession();
    const params = new URLSearchParams({ interval: "1d", range: "3mo", ...(crumb ? { crumb } : {}) });
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?${params}`, {
      headers: { "User-Agent": YAHOO_UA, ...(cookie ? { Cookie: `A3=${cookie}` } : {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
    };
    return (payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
      .filter((value): value is number => typeof value === "number" && value > 0);
  } catch {
    return [];
  }
}

/**
 * 市场脉搏：大盘指数+板块ETF+波动率
 * GET /api/invest/market-pulse
 */
export async function GET(request: NextRequest) {
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

    const fetchQuote = async (symbol: string) => {
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
      const to = Math.floor(Date.now() / 1000);
      const from = to - 45 * 24 * 60 * 60;
      try {
        const response = await fetch(
          `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`,
          { signal: AbortSignal.timeout(6000) },
        );
        if (!response.ok) throw new Error("finnhub_history_unavailable");
        const payload = (await response.json()) as { s?: string; c?: unknown };
        const closes = payload.s === "ok" && Array.isArray(payload.c)
          ? payload.c.filter((value): value is number => typeof value === "number" && value > 0)
          : await fetchYahooCloses(symbol);
        const close5d = closes.length >= 6 ? closes[closes.length - 6] : null;
        const close20d = closes.length >= 21 ? closes[closes.length - 21] : null;
        return {
          changePct5d: close5d ? ((currentPrice - close5d) / close5d) * 100 : null,
          changePct20d: close20d ? ((currentPrice - close20d) / close20d) * 100 : null,
        };
      } catch {
        const closes = await fetchYahooCloses(symbol);
        const close5d = closes.length >= 6 ? closes[closes.length - 6] : null;
        const close20d = closes.length >= 21 ? closes[closes.length - 21] : null;
        return {
          changePct5d: close5d ? ((currentPrice - close5d) / close5d) * 100 : null,
          changePct20d: close20d ? ((currentPrice - close20d) / close20d) * 100 : null,
        };
      }
    };

    const requestedSymbols = (new URL(request.url).searchParams.get("symbols") ?? "")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol, index, symbols) => /^[A-Z]{1,6}$/.test(symbol) && symbols.indexOf(symbol) === index)
      .slice(0, 20);

    if (requestedSymbols.length > 0) {
      const quotes = await Promise.all(requestedSymbols.map(async (symbol) => {
        const quote = await fetchQuote(symbol);
        return {
          symbol,
          price: quote?.price ?? null,
          change: quote?.change ?? null,
          changePct: quote?.changePct ?? null,
        };
      }));

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
      Promise.all(sectors.map(async (sec) => {
        const q = await fetchQuote(sec.symbol);
        const multiPeriod = await fetchMultiPeriodChange(sec.symbol, q?.price ?? null);
        return { ...sec, ...q, ...multiPeriod };
      })),
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

    return NextResponse.json({
      data: {
        indices: indexData,
        sectors: sectorData,
        sentiment,
        strongestSector: strongest ? `${strongest.name} (${strongest.changePct?.toFixed(2)}%)` : null,
        weakestSector: weakest ? `${weakest.name} (${weakest.changePct?.toFixed(2)}%)` : null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[market-pulse]", error);
    return NextResponse.json({ data: null });
  }
}
