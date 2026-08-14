import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "d9ve1m9r01qv408k7rf0d9ve1m9r01qv408k7rfg";

/**
 * 市场脉搏：大盘指数+板块ETF+波动率
 * GET /api/invest/market-pulse
 */
export async function GET(request: NextRequest) {
  try {
    const indices = [
      { symbol: "SPY", name: "标普500" },
      { symbol: "QQQ", name: "纳斯达克100" },
      { symbol: "DIA", name: "道琼斯" },
      { symbol: "IWM", name: "罗素2000（小盘）" },
      { symbol: "UVXY", name: "波动率（恐慌指数代理）" },
    ];

    const sectors = [
      { symbol: "XLK", name: "科技" },
      { symbol: "XLF", name: "金融" },
      { symbol: "XLE", name: "能源" },
      { symbol: "XLV", name: "医疗" },
      { symbol: "XLY", name: "可选消费" },
      { symbol: "XLP", name: "必需消费" },
      { symbol: "XLI", name: "工业" },
      { symbol: "XLU", name: "公用事业" },
      { symbol: "XLRE", name: "房地产" },
      { symbol: "XLB", name: "材料" },
      { symbol: "XLC", name: "通信服务" },
    ];

    const fetchQuote = async (symbol: string) => {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (!res.ok) return null;
      const d = await res.json();
      if (!d || d.c === 0) return null;
      return {
        price: d.c,
        change: d.d,
        changePct: d.dp,
      };
    };

    const requestedSymbols = (new URL(request.url).searchParams.get("symbols") ?? "")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol, index, symbols) => /^[A-Z]{1,6}$/.test(symbol) && symbols.indexOf(symbol) === index)
      .slice(0, 20);

    if (requestedSymbols.length > 0) {
      const quotes = await Promise.all(requestedSymbols.map(async (symbol) => {
        const quote = await fetchQuote(symbol);
        return {
          symbol,
          price: quote?.price ?? null,
          change: quote?.change ?? null,
          changePct: quote?.changePct ?? null,
        };
      }));

      return NextResponse.json(
        { data: { quotes, timestamp: new Date().toISOString() } },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const [indexData, sectorData] = await Promise.all([
      Promise.all(indices.map(async (idx) => {
        const q = await fetchQuote(idx.symbol);
        return { ...idx, ...q };
      })),
      Promise.all(sectors.map(async (sec) => {
        const q = await fetchQuote(sec.symbol);
        return { ...sec, ...q };
      })),
    ]);

    // 判断市场情绪
    const spy = indexData.find((i) => i.symbol === "SPY");
    const uvxy = indexData.find((i) => i.symbol === "UVXY");
    let sentiment = "中性";
    if (spy && uvxy) {
      if (spy.changePct != null && spy.changePct > 1 && uvxy.price < 20) sentiment = "偏乐观";
      else if (spy.changePct != null && spy.changePct < -1 || uvxy.price > 25) sentiment = "偏悲观";
      else if (uvxy.price > 30) sentiment = "恐慌";
    }

    // 找最强/最弱板块
    const validSectors = sectorData.filter((s) => s.changePct != null);
    const strongest = validSectors.length > 0
      ? [...validSectors].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))[0]
      : null;
    const weakest = validSectors.length > 0
      ? [...validSectors].sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0))[0]
      : null;

    return NextResponse.json({
      data: {
        indices: indexData,
        sectors: sectorData,
        sentiment,
        strongestSector: strongest ? `${strongest.name} (${strongest.changePct?.toFixed(2)}%)` : null,
        weakestSector: weakest ? `${weakest.name} (${weakest.changePct?.toFixed(2)}%)` : null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[market-pulse]", error);
    return NextResponse.json({ data: null });
  }
}
