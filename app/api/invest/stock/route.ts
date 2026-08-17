import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

interface FinnhubQuote {
  c?: number;
  d?: number;
  dp?: number;
  pc?: number;
  t?: number;
}

type FinnhubMetrics = Record<string, number | null | undefined>;

interface FinnhubProfile {
  name?: string;
  exchange?: string;
  marketCapitalization?: number;
  finnhubIndustry?: string;
  employeeTotal?: number;
}

interface FinnhubCandles {
  c?: Array<number | null>;
  t?: number[];
  v?: Array<number | null>;
  s?: string;
}

interface YahooChartResult {
  meta?: {
    longName?: string;
    shortName?: string;
    exchangeName?: string;
    regularMarketPrice?: number;
    regularMarketVolume?: number;
    chartPreviousClose?: number;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
}

async function getFinnhubQuote(code: string): Promise<FinnhubQuote | null> {
  if (!FINNHUB_KEY) return null;

  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(code)}&token=${FINNHUB_KEY}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!response.ok) return null;

    const quote = (await response.json()) as FinnhubQuote;
    return typeof quote.c === "number" && quote.c > 0 ? quote : null;
  } catch {
    return null;
  }
}

async function getFinnhubMetrics(code: string): Promise<FinnhubMetrics | null> {
  if (!FINNHUB_KEY) return null;

  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(code)}&metric=all&token=${FINNHUB_KEY}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as { metric?: FinnhubMetrics };
    return payload.metric && Object.keys(payload.metric).length > 0 ? payload.metric : null;
  } catch {
    return null;
  }
}

async function getFinnhubProfile(code: string): Promise<FinnhubProfile | null> {
  if (!FINNHUB_KEY) return null;

  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(code)}&token=${FINNHUB_KEY}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!response.ok) return null;

    const profile = (await response.json()) as FinnhubProfile;
    return profile.name ? profile : null;
  } catch {
    return null;
  }
}

async function getFinnhubHistory(code: string) {
  if (!FINNHUB_KEY) return [];

  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 365 * 24 * 60 * 60;
    const params = new URLSearchParams({
      symbol: code,
      resolution: "D",
      from: String(from),
      to: String(to),
      token: FINNHUB_KEY,
    });
    const response = await fetch(`https://finnhub.io/api/v1/stock/candle?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as FinnhubCandles;
    if (payload.s !== "ok" || !Array.isArray(payload.t) || !Array.isArray(payload.c)) return [];

    return payload.t
      .map((timestamp, index) => ({
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close: payload.c?.[index] ?? null,
        volume: payload.v?.[index] ?? null,
      }))
      .filter((candle) => candle.close != null);
  } catch {
    return [];
  }
}

async function getYahooChart(code: string): Promise<YahooChartResult | null> {
  // 尝试多个Yahoo域名和方式
  const yahooHosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  
  for (const host of yahooHosts) {
    try {
      let cookie = "";
      let crumb = "";

      // 方式1: 带cookie+crumb
      try {
        const cookieResponse = await fetch("https://fc.yahoo.com/", {
          headers: { "User-Agent": UA },
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        const setCookie = cookieResponse.headers.get("set-cookie") || "";
        const match = setCookie.match(/A3=([^;]+)/);
        if (match) cookie = match[1];

        if (cookie) {
          const crumbResponse = await fetch(`https://${host}/v1/test/getcrumb`, {
            headers: { "User-Agent": UA, Cookie: `A3=${cookie}` },
            signal: AbortSignal.timeout(5000),
          });
          if (crumbResponse.ok) crumb = (await crumbResponse.text()).trim();
        }
      } catch {
        // Cookie认证失败，继续尝试
      }

      const params = new URLSearchParams({
        interval: "1d",
        range: "3mo",
        ...(crumb ? { crumb } : {}),
      });
      const response = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(code)}?${params}`,
        {
          headers: {
            "User-Agent": UA,
            ...(cookie ? { Cookie: `A3=${cookie}` } : {}),
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) continue;

      const payload = (await response.json()) as {
        chart?: { result?: YahooChartResult[]; error?: { code?: string; description?: string } };
      };
      if (payload.chart?.result?.[0]) {
        return payload.chart.result[0];
      }
      // 继续尝试下一个host
    } catch {
      // 继续尝试下一个host
    }
  }

  // 方式2: 不带cookie直接请求（有时能成功）
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}?interval=1d&range=3mo`,
      {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (response.ok) {
      const payload = (await response.json()) as {
        chart?: { result?: YahooChartResult[] };
      };
      if (payload.chart?.result?.[0]) {
        return payload.chart.result[0];
      }
    }
  } catch {
    // 最终失败
  }

  return null;
}

/**
 * 美股实时行情、历史K线与财务指标。
 * GET /api/invest/stock?code=AAPL
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "stock", {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const rawCode = new URL(request.url).searchParams.get("code")?.trim().toUpperCase();
  if (!rawCode || !/^[A-Z]{1,5}$/.test(rawCode)) {
    return NextResponse.json({ error: "请输入有效的美股代码（如 AAPL）" }, { status: 400 });
  }

  const code = rawCode;

  try {
    const [quote, metrics, profile, yahooResult] = await Promise.all([
      getFinnhubQuote(code),
      getFinnhubMetrics(code),
      getFinnhubProfile(code),
      getYahooChart(code),
    ]);

    const price = quote?.c ?? yahooResult?.meta?.regularMarketPrice ?? null;
    const previousClose = quote?.pc ?? yahooResult?.meta?.chartPreviousClose ?? null;
    const change = quote?.d ?? (price != null && previousClose != null ? price - previousClose : null);
    const changePct = quote?.dp ?? (change != null && previousClose ? (change / previousClose) * 100 : null);

    const timestamps = yahooResult?.timestamp ?? [];
    const closes = yahooResult?.indicators?.quote?.[0]?.close ?? [];
    const volumes = yahooResult?.indicators?.quote?.[0]?.volume ?? [];
    const yahooCandles = timestamps
      .map((timestamp, index) => ({
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close: closes[index] ?? null,
        volume: volumes[index] ?? null,
      }))
      .filter((candle) => candle.close != null);
    const candles = yahooCandles.length > 0 ? yahooCandles : await getFinnhubHistory(code);

    if (!quote && !yahooResult && candles.length === 0) {
      return NextResponse.json({ error: `未找到股票代码 ${code}` }, { status: 404 });
    }

    // 检测是否为ETF（有价格指标但没有PE/PB/ROE等个股指标）
    const isETF = metrics != null && 
      metrics.peNormalizedAnnual == null && 
      metrics.roeRfy == null &&
      (metrics.beta != null || metrics["52WeekHigh"] != null);

    const financials: Record<string, unknown> | null = metrics
      ? {
          pe: metrics.peNormalizedAnnual ?? metrics.peTTM ?? null,
          forwardPe: metrics.forwardPEAnnual ?? null,
          pb: metrics.pbAnnual ?? metrics.pbQuarterly ?? null,
          ps: metrics.psAnnual ?? null,
          evToEbitda: metrics.enterpriseValueToEbitdaTTM ?? null,
          dividendYield: metrics.dividendYieldIndicated ?? null,
          payoutRatio: metrics.payoutRatioTTM ?? null,
          beta: metrics.beta5YearAnnualized ?? metrics.beta ?? null,
          roe: metrics.roeRfy ?? metrics.roeTTM ?? null,
          roa: metrics.roaTTM ?? null,
          grossMargin: metrics.grossMarginAnnual ?? metrics.grossMarginTTM ?? null,
          operatingMargin: metrics.operatingMarginAnnual ?? metrics.operatingMarginTTM ?? null,
          profitMargin: metrics.netProfitMarginAnnual ?? metrics.netMarginTTM ?? null,
          debtToEquity: metrics["totalDebt/totalEquityAnnual"] ?? null,
          currentRatio: metrics.currentRatioAnnual ?? null,
          quickRatio: metrics.quickRatioAnnual ?? null,
          revenueGrowth: metrics.revenueGrowth5Y ?? metrics.revenueGrowthQuarterlyYoy ?? null,
          earningsGrowth: metrics.epsGrowth5Y ?? metrics.epsGrowthQuarterlyYoy ?? null,
          totalCash: metrics.cashAndEquivalentsAnnual ?? null,
          totalDebt: metrics.totalDebtAnnual ?? null,
          freeCashflow: metrics.freeCashFlowTTM ?? null,
          operatingCashflow: metrics.cashFlowOperatingTTM ?? null,
          eps: metrics.epsNormalizedAnnual ?? metrics.epsTTM ?? null,
          forwardEps: metrics.epsForward ?? null,
          pegRatio: metrics.pegRatio ?? null,
          enterpriseValue: metrics.enterpriseValueAnnual ?? null,
          profitMargins: metrics.netProfitMarginAnnual ?? null,
          sector: profile?.finnhubIndustry ?? null,
          industry: profile?.finnhubIndustry ?? null,
          fullTimeEmployees: profile?.employeeTotal ?? null,
          longBusinessSummary: profile?.name
            ? isETF
              ? `${profile.name} 是一只ETF（交易所交易基金），不适用个股财务指标（PE/PB/ROE等）。`
              : `${profile.name} (${code}) — ${profile.finnhubIndustry || ""}`
            : null,
        }
      : null;

    return NextResponse.json({
      data: {
        code,
        name: profile?.name || yahooResult?.meta?.longName || yahooResult?.meta?.shortName || code,
        currency: "USD",
        exchange: profile?.exchange || yahooResult?.meta?.exchangeName || "",
        price: price != null ? Number(price.toFixed(2)) : null,
        previousClose: previousClose != null ? Number(previousClose.toFixed(2)) : null,
        change: change != null ? Number(change.toFixed(2)) : null,
        changePct: changePct != null ? Number(changePct.toFixed(2)) : null,
        volume: yahooResult?.meta?.regularMarketVolume ?? null,
        marketCap: profile?.marketCapitalization ? profile.marketCapitalization * 1_000_000 : null,
        fiftyTwoWeekHigh: yahooResult?.meta?.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: yahooResult?.meta?.fiftyTwoWeekLow ?? null,
        candles,
        financials,
        realtime: Boolean(quote),
        isETF,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/stock] ${code} error: ${message}`);
    return NextResponse.json({ error: "行情数据暂时不可用，请稍后重试" }, { status: 503 });
  }
}
