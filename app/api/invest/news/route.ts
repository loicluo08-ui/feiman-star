import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

/**
 * 公司新闻+盈利日历
 * GET /api/invest/news?code=AAPL
 */

const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

// Yahoo搜索端点兜底（Finnhub company-news是premium-only，免费层恒空）
async function getYahooNews(code: string): Promise<Array<{ headline: string; source: string; url: string; date: string; summary: string }>> {
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
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(code)}&newsCount=5&quotesCount=0`,
      { headers: browserHeaders, signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { news?: Array<{ title?: string; publisher?: string; link?: string; providerPublishTime?: number }> };
    return (data.news ?? [])
      .filter((n) => n.title && n.link)
      .slice(0, 5)
      .map((n) => ({
        headline: n.title as string,
        source: n.publisher || "Yahoo Finance",
        url: n.link as string,
        date: n.providerPublishTime ? fmt(new Date(n.providerPublishTime * 1000)) : "",
        summary: "",
      }));
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim().toUpperCase();

  if (!code || !/^[A-Z]{1,5}(\.[A-Z])?$/.test(code)) {
    return NextResponse.json({ error: "无效的股票代码" }, { status: 400 });
  }

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
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

    // Finnhub company-news免费层premium-only恒空 → Yahoo兜底
    let finalNews: Array<{ headline: string; source: string; url: string; date: string; summary: string }> = news;
    if (finalNews.length === 0) {
      finalNews = await getYahooNews(code);
    }

    return NextResponse.json({ data: { news: finalNews, nextEarnings } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/news] ${code} ${message}`);
    return NextResponse.json({ data: { news: [], nextEarnings: null } });
  }
}
