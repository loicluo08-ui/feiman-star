import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 东方财富实时行情代理
 * GET /api/invest/stock?code=600519&market=sh
 * market: sh | sz | bj
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim();
  const market = searchParams.get("market")?.trim() || "sh";

  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "股票代码应为6位数字" }, { status: 400 });
  }

  const secid = `${market === "sz" ? "0" : market === "bj" ? "0" : "1"}.${code}`;

  try {
    // 实时行情
    const quoteUrl = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f50,f51,f52,f57,f58,f60,f116,f117,f162,f167,f168,f169,f170,f171,f292`;
    const quoteRes = await fetch(quoteUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!quoteRes.ok) throw new Error(`eastmoney_status=${quoteRes.status}`);
    const quoteData = await quoteRes.json();

    // 简化的财务数据
    const financeUrl = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f9,f23,f20,f21,f27,f100,f103,f116,f117,f162,f163,f173`;
    const financeRes = await fetch(financeUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    const financeData = financeRes.ok ? await financeRes.json() : null;

    return NextResponse.json({
      data: {
        quote: quoteData?.data ?? null,
        finance: financeData?.data ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/stock] ${message}`);
    return NextResponse.json({ error: "行情数据暂时不可用" }, { status: 503 });
  }
}
