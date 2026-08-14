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
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
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
