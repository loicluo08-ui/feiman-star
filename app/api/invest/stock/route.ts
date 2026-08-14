import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "d9ve1m9r01qv408k7rf0d9ve1m9r01qv408k7rfg";

// Finnhub实时行情
async function getFinnhubQuote(code: string) {
  if (!FINNHUB_KEY) return null;
  try {
    // === 1. Finnhub实时行情 ===
    const [quote, metrics, profile] = await Promise.all([
      getFinnhubQuote(code),
      getFinnhubMetrics(code),
      getFinnhubProfile(code),
    ]);

    // === 2. Yahoo Finance K线（3个月）===
    const yahooResult = await getYahooChart(code);

    if (!quote && !yahooResult) {
      return NextResponse.json({ error: `未找到股票代码 ${code}` }, { status: 404 });
    }

    // === 3. 组装响应 ===
    // 实时价格用Finnhub（实时），K线用Yahoo（延迟15分钟但只看历史走势）
    const price = quote?.c ?? yahooResult?.meta?.regularMarketPrice ?? null;
    const prevClose = quote?.pc ?? yahooResult?.meta?.chartPreviousClose ?? null;
    const change = quote?.d ?? (price != null && prevClose != null ? price - prevClose : null);
    const changePct = quote?.dp ?? (change != null && prevClose ? (change / prevClose) * 100 : null);

    // K线数据
    const timestamps: number[] = yahooResult?.timestamp ?? [];
    const closes: (number | null)[] = yahooResult?.indicators?.quote?.[0]?.close ?? [];
    const volumes: (number | null)[] = yahooResult?.indicators?.quote?.[0]?.volume ?? [];
    const candles = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        close: closes[i] ?? null,
        volume: volumes[i] ?? null,
      }))
      .filter((c) => c.close != null);

    // 财务指标（Finnhub优先，Yahoo quoteSummary fallback）
    let financials: Record<string, unknown> | null = null;
    if (metrics) {
      financials = {
        pe: metrics.peNormalizedAnnual ?? metrics.peTTM ?? null,
        forwardPe: metrics.forwardPEAnnual ?? null,
        pb: metrics.pbAnnual ?? metrics.pbQuarterly ?? null,
        ps: metrics.psAnnual ?? null,
        evToEbitda: metrics.enterpriseValueToEbitdaTTM ?? null,
        dividendYield: metrics.dividendYieldIndicated ?? null,
        payoutRatio: metrics.payoutRatioTTM ?? null,
        beta: metrics.beta5YearAnnualized ?? null,
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
        longBusinessSummary: profile?.name ? `${profile.name} (${code}) — ${profile.finnhubIndustry || ""}` : null,
      };
    }

    return NextResponse.json({
      data: {
        code,
        name: profile?.name || yahooResult?.meta?.longName || yahooResult?.meta?.shortName || code,
        currency: "USD",
        exchange: profile?.exchange || yahooResult?.meta?.exchangeName || "",
        price: price ? Number(price.toFixed(2)) : null,
        previousClose: prevClose ? Number(prevClose.toFixed(2)) : null,
        change: change ? Number(change.toFixed(2)) : null,
        changePct: changePct ? Number(changePct.toFixed(2)) : null,
        volume: quote?.t ? (yahooResult?.meta?.regularMarketVolume ?? null) : null,
        marketCap: profile?.marketCapitalization ? profile.marketCapitalization * 1000000 : null,
        fiftyTwoWeekHigh: yahooResult?.meta?.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: yahooResult?.meta?.fiftyTwoWeekLow ?? null,
        candles,
        financials,
        realtime: !!quote,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/stock] ${code} error: ${message}`);
    console.error(`[invest/stock] finnhub_key: ${FINNHUB_KEY ? "set" : "NOT SET"}`);
    return NextResponse.json({ error: `行情数据暂时不可用: ${message}` }, { status: 503 });
  }
}
