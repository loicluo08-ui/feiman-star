import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 美股实时行情代理（Yahoo Finance）
 * GET /api/invest/stock?code=AAPL
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawCode = searchParams.get("code")?.trim().toUpperCase();

  if (!rawCode || !/^[A-Z]{1,6}$/.test(rawCode)) {
    return NextResponse.json({ error: "请输入有效的美股代码（如 AAPL）" }, { status: 400 });
  }

  const code = rawCode;

  try {
    // 实时行情 + 日K
    const quoteUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${code}?interval=1d&range=5d`;
    const quoteRes = await fetch(quoteUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!quoteRes.ok) {
      if (quoteRes.status === 404) {
        return NextResponse.json({ error: `未找到股票代码 ${code}` }, { status: 404 });
      }
      throw new Error(`yahoo_status=${quoteRes.status}`);
    }

    const quoteJson = await quoteRes.json();
    const result = quoteJson?.chart?.result?.[0];
    if (!result) throw new Error("yahoo_empty_response");

    const meta = result.meta ?? {};
    const indicators = result.indicators?.quote?.[0] ?? {};
    const timestamps = result.timestamp ?? [];
    const closes = indicators.close ?? [];
    const volumes = indicators.volume ?? [];

    // 最近一个交易日数据
    const lastIdx = closes.length - 1;
    const lastClose = closes[lastIdx];
    const prevClose = lastIdx > 0 ? closes[lastIdx - 1] : meta.chartPreviousClose;
    const change = lastClose && prevClose ? lastClose - prevClose : null;
    const changePct = lastClose && prevClose ? (change / prevClose) * 100 : null;

    // 5日量价
    const candles = timestamps.map((t: number, i: number) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      close: closes[i] ?? null,
      volume: volumes[i] ?? null,
    })).filter((c: { close: number | null }) => c.close != null);

    return NextResponse.json({
      data: {
        code,
        name: meta.longName || meta.shortName || code,
        currency: meta.currency || "USD",
        exchange: meta.exchangeName || meta.fullExchangeName || "",
        price: lastClose ?? null,
        previousClose: prevClose ?? null,
        change: change ? Number(change.toFixed(2)) : null,
        changePct: changePct ? Number(changePct.toFixed(2)) : null,
        volume: meta.regularMarketVolume ?? null,
        marketCap: meta.marketCap ?? null,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
        candles,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/stock] ${code} ${message}`);
    return NextResponse.json({ error: "行情数据暂时不可用，请稍后重试" }, { status: 503 });
  }
}
