import { NextRequest, NextResponse } from "next/server";
import { getYahooChart, type YahooChartResult } from "@/lib/yahoo-chart";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getFutuStock } from "@/lib/futu";
import { getQtStock } from "@/lib/qt";
import { fetchSADaily } from "@/lib/stockanalysis";

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Yahoo quoteSummary兜底（Finnhub metrics/profile是premium恒空）
// crumb链：fc.yahoo.com拿cookie → getcrumb → 带认证调quoteSummary
// Vercel出口IP池可能破坏crumb绑定→尽力而为，失败保持null
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://finance.yahoo.com/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

let yahooCrumb: { crumb: string; cookie: string; expiresAt: number } | null = null;

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (yahooCrumb && yahooCrumb.expiresAt > Date.now()) {
    return { crumb: yahooCrumb.crumb, cookie: yahooCrumb.cookie };
  }
  try {
    const cookieRes = await fetch("https://fc.yahoo.com", { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(4000) });
    const cookies = (cookieRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    if (!cookies) return null;
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { ...BROWSER_HEADERS, Cookie: cookies },
      signal: AbortSignal.timeout(4000),
    });
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 32) return null;
    yahooCrumb = { crumb, cookie: cookies, expiresAt: Date.now() + 5 * 60 * 1000 };
    return { crumb, cookie: cookies };
  } catch {
    return null;
  }
}

type YahooVal = { raw?: number } | number | undefined;
function ynum(v: YahooVal): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  return typeof v.raw === "number" ? v.raw : null;
}

async function getYahooSummary(code: string): Promise<{ metrics: FinnhubMetrics | null; profile: FinnhubProfile | null }> {
  try {
    const auth = await getYahooCrumb();
    if (!auth) return { metrics: null, profile: null };
    const yahooCode = code.replace(".", "-");
    const res = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooCode)}?modules=assetProfile,financialData,defaultKeyStatistics&crumb=${encodeURIComponent(auth.crumb)}`,
      { headers: { ...BROWSER_HEADERS, Cookie: auth.cookie }, signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return { metrics: null, profile: null };
    const payload = (await res.json()) as {
      quoteSummary?: {
        result?: Array<{
          assetProfile?: { sector?: string; industry?: string; fullTimeEmployees?: number; longBusinessSummary?: string };
          financialData?: Record<string, YahooVal>;
          defaultKeyStatistics?: Record<string, YahooVal>;
        }>;
      };
    };
    const r = payload.quoteSummary?.result?.[0];
    if (!r) return { metrics: null, profile: null };

    const fd = r.financialData ?? {};
    const ks = r.defaultKeyStatistics ?? {};
    const pct = (v: YahooVal): number | null => {
      const n = ynum(v);
      return n == null ? null : n <= 1.5 ? n * 100 : n; // Yahoo比率是小数(0.56)，Finnhub是百分数(56)
    };

    const metrics: Partial<FinnhubMetrics> = {
      roeTTM: pct(fd.returnOnEquity) ?? undefined,
      roaTTM: pct(fd.returnOnAssets) ?? undefined,
      grossMarginTTM: pct(fd.grossMargins) ?? undefined,
      operatingMarginTTM: pct(fd.operatingMargins) ?? undefined,
      netMarginTTM: pct(fd.profitMargins) ?? undefined,
      "totalDebt/totalEquityAnnual": ynum(fd.debtToEquity) ?? undefined,
      currentRatioAnnual: ynum(fd.currentRatio) ?? undefined,
      quickRatioAnnual: ynum(fd.quickRatio) ?? undefined,
      revenueGrowthQuarterlyYoy: pct(fd.revenueGrowth) ?? undefined,
      epsGrowthQuarterlyYoy: pct(fd.earningsGrowth) ?? undefined,
      totalCashAnnual: ynum(fd.totalCash) ?? undefined,
      totalDebtAnnual: ynum(fd.totalDebt) ?? undefined,
      freeCashFlowTTM: ynum(fd.freeCashflow) ?? undefined,
      cashFlowOperatingTTM: ynum(fd.operatingCashflow) ?? undefined,
      epsForward: ynum(ks.forwardEps) ?? undefined,
      pegRatio: ynum(ks.pegRatio) ?? undefined,
      enterpriseValueAnnual: ynum(ks.enterpriseValue) ?? undefined,
    };
    const profile: Partial<FinnhubProfile> = {
      name: undefined,
      finnhubIndustry: r.assetProfile?.industry ?? r.assetProfile?.sector ?? undefined,
      employeeTotal: r.assetProfile?.fullTimeEmployees ?? undefined,
    };
    return { metrics: metrics as FinnhubMetrics, profile: profile as FinnhubProfile };
  } catch {
    return { metrics: null, profile: null };
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
  if (!rawCode || !/^[A-Z]{1,5}(\.[A-Z])?$/.test(rawCode)) {
    return NextResponse.json({ error: "请输入有效的美股代码（如 AAPL）" }, { status: 400 });
  }

  const code = rawCode;

  try {
    // 腾讯为主源（实时免费），富途/Finnhub/Yahoo兜底
    const [qt, futu, quote, fhMetrics, fhProfile, yahooResult] = await Promise.all([
      getQtStock(code),
      getFutuStock(code),
      getFinnhubQuote(code),
      getFinnhubMetrics(code),
      getFinnhubProfile(code),
      getYahooChart(code),
    ]);
    // Finnhub metrics/profile免费层premium恒空 → Yahoo quoteSummary兜底（crumb尽力而为）
    let metrics = fhMetrics;
    let profile = fhProfile;
    if (metrics == null || profile == null) {
      const ysum = await getYahooSummary(code);
      if (metrics == null && ysum.metrics) metrics = ysum.metrics;
      if (profile == null && ysum.profile) profile = ysum.profile;
    }

    const price = qt?.price ?? futu?.price ?? quote?.c ?? yahooResult?.meta?.regularMarketPrice ?? null;
    const previousClose =
      qt?.previousClose ?? futu?.previousClose ?? quote?.pc ?? yahooResult?.meta?.chartPreviousClose ?? null;
    const change = qt?.change ?? quote?.d ?? (price != null && previousClose != null ? price - previousClose : null);
    const changePct = qt?.changePct ?? quote?.dp ?? (change != null && previousClose ? (change / previousClose) * 100 : null);

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
    // 2026-08-23：Yahoo被Vercel出口IP限流429，加stockanalysis日线兜底（Finnhub candle免费版已停403）
    let candles = yahooCandles.length > 0 ? yahooCandles : await getFinnhubHistory(code);
    if (candles.length === 0) {
      candles = await fetchSADaily(code, 180);
    }

    // 404判定修正：腾讯/富途已返回价格时不应误报"未找到"（2026-08-23，QQQ线上误报404修复）
    const hasLivePrice = price != null;
    if (!quote && !yahooResult && candles.length === 0 && !hasLivePrice) {
      return NextResponse.json({ error: `未找到股票代码 ${code}` }, { status: 404 });
    }

    // 检测是否为ETF（有价格指标但没有PE/PB/ROE等个股指标）
    // ETF判定：Yahoo instrumentType最可靠；Finnhub metrics形状启发式（pe/roe空+beta存在）兜底
    const yahooIsETF = yahooResult?.meta?.instrumentType === "ETF";
    const finnhubIsETF = metrics != null && 
      metrics.peNormalizedAnnual == null && 
      metrics.roeRfy == null &&
      (metrics.beta != null || metrics["52WeekHigh"] != null);
    const isETF = yahooIsETF || finnhubIsETF;

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
        name: qt?.name || futu?.name || profile?.name || yahooResult?.meta?.longName || yahooResult?.meta?.shortName || code,
        currency: "USD",
        exchange: profile?.exchange || yahooResult?.meta?.exchangeName || "",
        price: price != null ? Number(price.toFixed(2)) : null,
        previousClose: previousClose != null ? Number(previousClose.toFixed(2)) : null,
        change: change != null ? Number(change.toFixed(2)) : null,
        changePct: changePct != null ? Number(changePct.toFixed(2)) : null,
        open: qt?.open ?? futu?.open ?? null,
        high: qt?.high ?? futu?.high ?? null,
        low: qt?.low ?? futu?.low ?? null,
        volume: qt?.volume ?? futu?.volume ?? yahooResult?.meta?.regularMarketVolume ?? null,
        turnover: qt?.turnover ?? futu?.turnover ?? null,
        marketCap: qt?.marketCap ?? futu?.marketCap ?? (profile?.marketCapitalization ? profile.marketCapitalization * 1_000_000 : null),
        fiftyTwoWeekHigh: yahooResult?.meta?.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: yahooResult?.meta?.fiftyTwoWeekLow ?? null,
        candles,
        financials: financials
          ? {
              ...financials,
              pe: financials.pe ?? qt?.pe ?? futu?.peTtm ?? null,
              pb: financials.pb ?? futu?.pb ?? null,
              eps: financials.eps ?? futu?.eps ?? null,
            }
          : financials,
        realtime: Boolean(qt || futu || quote),
        isETF,
        source: qt ? "tencent" : futu ? "futu" : quote ? "finnhub" : "yahoo",
        dataTime: qt?.time ?? futu?.dataTime ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/stock] ${code} error: ${message}`);
    return NextResponse.json({ error: "行情数据暂时不可用，请稍后重试" }, { status: 503 });
  }
}
