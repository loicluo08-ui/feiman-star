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
    const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "d9ve1m9r01qv408k7rf0d9ve1m9r01qv408k7rfg";
    if (!FINNHUB_KEY) {
      return NextResponse.json({ data: [] });
    }

    const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return NextResponse.json({ data: [] });

    const json = await res.json();
    const results: Array<Record<string, unknown>> = json.result ?? [];

    const filtered = results
      .filter((r) => {
        const sym = r.symbol as string;
        // 只保留美股代码（纯字母，不含点）
        return /^[A-Z]{1,6}$/.test(sym);
      })
      .map((r) => ({
        code: r.symbol as string,
        name: (r.description ?? r.symbol) as string,
        exchange: null,
        type: "EQUITY",
      }))
      .slice(0, 8);

    return NextResponse.json({ data: filtered });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[invest/search] ${message}`);
    return NextResponse.json({ data: [] });
  }
}
