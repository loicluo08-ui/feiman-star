import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * 美股搜索代理（Yahoo Finance search）
 * GET /api/invest/search?q=apple
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 1) {
    return NextResponse.json({ data: [] });
  }

  try {
    // 先获取cookie+crumb
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
        if (crumbRes.ok) crumb = (await crumbRes.text()).trim();
      }
    } catch {}

    const searchParams = new URLSearchParams({
      q,
      quotesCount: "8",
      newsCount: "0",
      enableFuzzyQuery: "false",
      quotesQueryId: "tss_match_phrase_query",
      ...(crumb ? { crumb } : {}),
    });
    const url = `https://query1.finance.yahoo.com/v1/finance/search?${searchParams}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        ...(cookie ? { Cookie: `A3=${cookie}` } : {}),
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      return NextResponse.json({ data: [] });
    }

    const json = await res.json();
    const quotes: Array<Record<string, unknown>> = json.quotes ?? [];

    const results = quotes
      .filter((q) => q.quoteType === "EQUITY" || q.quoteType === "ETF")
      .filter((q) => {
        const exch = q.exchange;
        return exch === "NYQ" || exch === "NMS" || exch === "NGM" || exch === "PCX" || exch === "ASE" || exch === "PNK" || !exch;
      })
      .map((q) => ({
        code: q.symbol as string,
        name: (q.longname ?? q.shortname ?? q.symbol) as string,
        exchange: q.exchange as string | null,
        type: q.quoteType as string,
      }))
      .slice(0, 8);

    return NextResponse.json({ data: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/search] ${message}`);
    return NextResponse.json({ data: [] });
  }
}
