import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

/**
 * 公司新闻+盈利日历
 * GET /api/invest/news?code=AAPL
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim().toUpperCase();

  if (!code || !/^[A-Z]{1,6}$/.test(code)) {
    return NextResponse.json({ error: "无效的股票代码" }, { status: 400 });
  }

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const todayStr = fmt(today);
  const weekAgoStr = fmt(weekAgo);

  try {
    // 公司新闻（最近7天，取5条）
    const newsRes = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(code)}&from=${weekAgoStr}&to=${todayStr}&token=${FINNHUB_KEY}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const allNews = newsRes.ok ? await newsRes.json() : [];
    const news = (Array.isArray(allNews) ? allNews : [])
      .sort((a: { datetime: number }, b: { datetime: number }) => (b.datetime ?? 0) - (a.datetime ?? 0))
      .slice(0, 5)
      .map((n: { headline: string; source: string; url: string; datetime: number; summary: string }) => ({
        headline: n.headline,
        source: n.source,
        url: n.url,
        date: n.datetime ? fmt(new Date(n.datetime * 1000)) : "",
        summary: (n.summary ?? "").slice(0, 200),
      }));

    // 盈利日历（未来30天）
    const todayPlus30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const earningsRes = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${todayStr}&to=${fmt(todayPlus30)}&token=${FINNHUB_KEY}`,
      { signal: AbortSignal.timeout(8000) },
    );
    let nextEarnings: { date: string; epsEstimate: number | null; hour: string } | null = null;
    if (earningsRes.ok) {
      const earningsData = await earningsRes.json();
      const earningsList: Array<{ symbol: string; date: string; epsEstimate: number | null; hour: string }> =
        earningsData.earningsCalendar ?? [];
      const found = earningsList.find((e) => e.symbol === code);
      if (found) {
        nextEarnings = {
          date: found.date,
          epsEstimate: found.epsEstimate,
          hour: found.hour || "",
        };
      }
    }

    return NextResponse.json({ data: { news, nextEarnings } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/news] ${code} ${message}`);
    return NextResponse.json({ data: { news: [], nextEarnings: null } });
  }
}
