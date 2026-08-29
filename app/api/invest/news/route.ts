import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

/**
 * 公司新闻+盈利日历
 * GET /api/invest/news?code=AAPL
 */

// 服务端缓存：全链路最多5次串行外部请求（Finnhub→cookie→crumb→quoteSummary→Yahoo兜底）
// 新闻/财报日期数据频率低，10分钟TTL在新鲜度和成本间取平衡
const newsCache = new Map<string, { data: unknown; expiresAt: number }>();
const NEWS_TTL = 10 * 60 * 1000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://finance.yahoo.com/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

// Yahoo搜索端点兜底（Finnhub company-news是premium-only，免费层恒空）
async function getYahooNews(code: string): Promise<Array<{ headline: string; source: string; url: string; date: string; summary: string }>> {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(code)}&newsCount=5&quotesCount=0`,
      { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(6000) },
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
  const limited = enforceRateLimit(request, "news", { maxRequests: 60, windowMs: 60_000 });
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim().toUpperCase();

  if (!code || !/^[A-Z]{1,5}(\.[A-Z])?$/.test(code)) {
    return NextResponse.json({ error: "无效的股票代码" }, { status: 400 });
  }

  const cached = newsCache.get(code);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ data: cached.data, cached: true });
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

    // 下次财报：Finnhub calendar/earnings是premium恒空 → Yahoo quoteSummary calendarEvents（crumb链尽力而为）
    let nextEarnings: { date: string; epsEstimate: number | null; hour: string } | null = null;
    try {
      const cookieRes = await fetch("https://fc.yahoo.com", { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(4000) });
      const cookies = (cookieRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
      if (cookies) {
        const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
          headers: { ...BROWSER_HEADERS, Cookie: cookies },
          signal: AbortSignal.timeout(4000),
        });
        const crumb = (await crumbRes.text()).trim();
        if (crumb && crumb.length <= 32) {
          const calRes = await fetch(
            `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(code.replace(".", "-"))}?modules=calendarEvents&crumb=${encodeURIComponent(crumb)}`,
            { headers: { ...BROWSER_HEADERS, Cookie: cookies }, signal: AbortSignal.timeout(6000) },
          );
          if (calRes.ok) {
            const cal = (await calRes.json()) as {
              quoteSummary?: { result?: Array<{ calendarEvents?: { earnings?: { earningsDate?: Array<{ raw?: number; fmt?: string }>; earningsAverage?: { raw?: number } } } }> };
            };
            const e = cal.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
            const ed = e?.earningsDate?.[0];
            if (ed && (ed.raw || ed.fmt)) {
              const ts = ed.raw ? ed.raw * 1000 : new Date(ed.fmt as string).getTime();
              // 只取未来30天内的财报日
              if (ts > Date.now() - 86400000 && ts < Date.now() + 31 * 86400000) {
                const nyHour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date(ts));
                nextEarnings = {
                  date: ed.fmt ?? new Date(ts).toISOString().slice(0, 10),
                  epsEstimate: e?.earningsAverage?.raw ?? null,
                  hour: parseInt(nyHour) < 12 ? "bmo" : "amc",
                };
              }
            }
          }
        }
      }
    } catch {}

    // Finnhub company-news免费层premium-only恒空 → Yahoo兜底
    let finalNews: Array<{ headline: string; source: string; url: string; date: string; summary: string }> = news;
    if (finalNews.length === 0) {
      finalNews = await getYahooNews(code);
    }

    const data = { news: finalNews, nextEarnings };
    newsCache.set(code, { data, expiresAt: Date.now() + NEWS_TTL });

    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/news] ${code} ${message}`);
    return NextResponse.json({ data: { news: [], nextEarnings: null } });
  }
}
