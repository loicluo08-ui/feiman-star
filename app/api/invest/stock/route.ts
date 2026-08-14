import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * 美股完整行情+财务数据代理（Yahoo Finance）
 * GET /api/invest/stock?code=AAPL
 */
export async function GET(request: NextRequest) {
  // 限流：选股场景单用户不会高频，但防止滥用
  const limited = enforceRateLimit(request, "chat", RATE_LIMITS.chat);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawCode = searchParams.get("code")?.trim().toUpperCase();

  if (!rawCode || !/^[A-Z]{1,6}$/.test(rawCode)) {
    return NextResponse.json({ error: "请输入有效的美股代码（如 AAPL）" }, { status: 400 });
  }

  const code = rawCode;

  try {
    // === 0. 获取Yahoo Finance cookie + crumb ===
    let cookie = "";
    let crumb = "";
    try {
      const cookieRes = await fetch("https://fc.yahoo.com/", {
        headers: { "User-Agent": UA },
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      const setCookie = cookieRes.headers.get("set-cookie") || "";
      const match = setCookie.match(/A3=([^;]+)/);
      if (match) cookie = match[1];

      if (cookie) {
        const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
          headers: { "User-Agent": UA, Cookie: `A3=${cookie}` },
          signal: AbortSignal.timeout(5000),
        });
        if (crumbRes.ok) {
          crumb = (await crumbRes.text()).trim();
        }
      }
    } catch {
      // cookie获取失败，继续尝试不带认证
    }

    // === 1. 主行情+日K（3个月≈120日）===
    const chartParams = new URLSearchParams({
      interval: "1d",
      range: "3mo",
      ...(crumb ? { crumb } : {}),
    });
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${code}?${chartParams}`;
    const chartRes = await fetch(chartUrl, {
      headers: {
        "User-Agent": UA,
        ...(cookie ? { Cookie: `A3=${cookie}` } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!chartRes.ok) {
      if (chartRes.status === 404) {
        return NextResponse.json({ error: `未找到股票代码 ${code}` }, { status: 404 });
      }
      throw new Error(`chart_status=${chartRes.status}`);
    }

    const chartJson = await chartRes.json();
    const result = chartJson?.chart?.result?.[0];
    if (!result) throw new Error("chart_no_result");

    const meta = result.meta ?? {};
    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const volumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? [];

    const lastClose = closes.length > 0 ? closes[closes.length - 1] : null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change = lastClose != null && prevClose != null ? lastClose - prevClose : null;
    const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;

    const candles = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        close: closes[i] ?? null,
        volume: volumes[i] ?? null,
      }))
      .filter((c) => c.close != null);

    // === 2. 财务指标（quoteSummary，失败不影响主流程）===
    // fallback链：quoteSummary(v10) → chart meta里的52周数据 → null
    let financials: Record<string, unknown> | null = null;
    try {
      const summaryParams = new URLSearchParams({
        modules: "summaryDetail,financialData,defaultKeyStatistics,assetProfile",
        ...(crumb ? { crumb } : {}),
      });
      const summaryUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${code}?${summaryParams}`;
      const summaryRes = await fetch(summaryUrl, {
        headers: {
          "User-Agent": UA,
          ...(cookie ? { Cookie: `A3=${cookie}` } : {}),
        },
        signal: AbortSignal.timeout(8000),
      });
      if (summaryRes.ok) {
        const summaryJson = await summaryRes.json();
        const sd = summaryJson?.quoteSummary?.result?.[0]?.summaryDetail ?? {};
        const fd = summaryJson?.quoteSummary?.result?.[0]?.financialData ?? {};
        const ks = summaryJson?.quoteSummary?.result?.[0]?.defaultKeyStatistics ?? {};
        const ap = summaryJson?.quoteSummary?.result?.[0]?.assetProfile ?? {};

        financials = {
          pe: sd.trailingPE?.raw ?? null,
          forwardPe: sd.forwardPE?.raw ?? null,
          pb: sd.priceToBook?.raw ?? null,
          ps: sd.priceToSalesTrailing12Months?.raw ?? null,
          evToEbitda: sd.enterpriseToEbitda?.raw ?? null,
          dividendYield: sd.dividendYield?.raw ?? null,
          payoutRatio: sd.payoutRatio?.raw ?? null,
          beta: sd.beta?.raw ?? null,
          roe: fd.returnOnEquity?.raw ?? null,
          roa: fd.returnOnAssets?.raw ?? null,
          grossMargin: fd.grossMargins?.raw ?? null,
          operatingMargin: fd.operatingMargins?.raw ?? null,
          profitMargin: fd.profitMargins?.raw ?? null,
          debtToEquity: fd.debtToEquity?.raw ?? null,
          currentRatio: fd.currentRatio?.raw ?? null,
          quickRatio: fd.quickRatio?.raw ?? null,
          revenueGrowth: fd.revenueGrowth?.raw ?? null,
          earningsGrowth: fd.earningsGrowth?.raw ?? null,
          totalCash: fd.totalCash?.raw ?? null,
          totalDebt: fd.totalDebt?.raw ?? null,
          freeCashflow: fd.freeCashflow?.raw ?? null,
          operatingCashflow: fd.operatingCashflow?.raw ?? null,
          eps: ks.trailingEps?.raw ?? null,
          forwardEps: ks.forwardEps?.raw ?? null,
          pegRatio: ks.pegRatio?.raw ?? null,
          enterpriseValue: ks.enterpriseValue?.raw ?? null,
          profitMargins: ks.profitMargins?.raw ?? null,
          sector: ap.sector ?? null,
          industry: ap.industry ?? null,
          fullTimeEmployees: ap.fullTimeEmployees ?? null,
          longBusinessSummary: ap.longBusinessSummary ?? null,
        };
      }
    } catch {
      // quoteSummary失败不影响主行情
    }

    // 如果quoteSummary失败，从chart meta补全52周数据
    if (!financials) {
      financials = {
        pe: null, forwardPe: null, pb: null, ps: null,
        evToEbitda: null, dividendYield: null, payoutRatio: null,
        beta: null, roe: null, roa: null, grossMargin: null,
        operatingMargin: null, profitMargin: null, debtToEquity: null,
        currentRatio: null, quickRatio: null, revenueGrowth: null,
        earningsGrowth: null, totalCash: null, totalDebt: null,
        freeCashflow: null, operatingCashflow: null, eps: null,
        forwardEps: null, pegRatio: null, enterpriseValue: null,
        profitMargins: null, sector: null, industry: null,
        fullTimeEmployees: null, longBusinessSummary: null,
      };
    }

    // === 3. 组装响应 ===
    return NextResponse.json({
      data: {
        code,
        name: meta.longName || meta.shortName || code,
        currency: meta.currency || "USD",
        exchange: meta.exchangeName || meta.fullExchangeName || "",
        price: lastClose ? Number(lastClose.toFixed(2)) : null,
        previousClose: prevClose ? Number(prevClose.toFixed(2)) : null,
        change: change ? Number(change.toFixed(2)) : null,
        changePct: changePct ? Number(changePct.toFixed(2)) : null,
        volume: meta.regularMarketVolume ?? null,
        marketCap: meta.marketCap ?? null,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
        candles,
        financials,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/stock] ${code} ${message}`);
    return NextResponse.json({ error: "行情数据暂时不可用，请稍后重试" }, { status: 503 });
  }
}
