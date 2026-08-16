/**
 * 股票代码提取器 + 实时行情获取
 */

const STOCK_ALIASES: Record<string, string> = {
  "苹果": "AAPL", "英伟达": "NVDA", "特斯拉": "TSLA", "亚马逊": "AMZN",
  "微软": "MSFT", "谷歌": "GOOGL", "meta": "META", "脸书": "META",
  "网飞": "NFLX", "奈飞": "NFLX", "超微": "AMD", "高通": "QCOM",
  "台积电": "TSM", "阿里": "BABA", "拼多多": "PDD", "京东": "JD",
  "百度": "BIDU", "理想": "LI", "蔚来": "NIO", "小鹏": "XPEV",
  "礼来": "LLY", "联合健康": "UNH", "摩根大通": "JPM",
  "迪士尼": "DIS", "耐克": "NKE", "波音": "BA", "高盛": "GS",
  "英特尔": "INTC", "甲骨文": "ORCL", "Adobe": "ADBE", "思科": "CSCO",
};

const STOP_WORDS = new Set(["PE","PB","ROE","ROA","EPS","CEO","CFO","CTO","IPO","ETF","GDP","CPI","FED","API","JSON","HTTP","URL","USD","USA","AI","ML","PR","IR","IT","AR","VR","PC","GB","TB","CPU","GPU","RAM","SSD","HDD","USB","HDMI","WTO","WHO","NYC","LAX","SFO","DC","LA","SF"]);

export function extractStockCodes(text: string): string[] {
  const codes = new Set<string>();
  const normalizedText = text.trim();

  // $AAPL 格式
  const dollarMatches = normalizedText.match(/\$([A-Z]{1,6})\b/g);
  if (dollarMatches) dollarMatches.forEach((m) => codes.add(m.slice(1)));

  // 括号内 AAPL
  const parenMatches = normalizedText.match(/[（(]([A-Z]{1,6})[）)]/g);
  if (parenMatches) {
    parenMatches.forEach((m) => {
      const code = m.replace(/[（()]/g, "");
      if (code.length >= 1 && code.length <= 6) codes.add(code);
    });
  }

  // 中文别名
  for (const [alias, code] of Object.entries(STOCK_ALIASES)) {
    if (normalizedText.includes(alias)) codes.add(code);
  }

  // 直接大写代码
  const codeMatches = normalizedText.match(/(?<![A-Z])([A-Z]{2,6})(?![A-Z])/g);
  if (codeMatches) {
    codeMatches.forEach((c) => {
      if (!STOP_WORDS.has(c) && c.length >= 2) codes.add(c);
    });
  }

  return Array.from(codes).slice(0, 3);
}

export async function fetchStockData(codes: string[]): Promise<Array<{
  code: string; name: string; price: number | null; pe: number | null;
  changePct: number | null; marketCap: number | null;
}>> {
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

  return Promise.all(codes.map(async (code) => {
    let price: number | null = null;
    let changePct: number | null = null;
    let name = code;
    let marketCap: number | null = null;
    let pe: number | null = null;

    if (FINNHUB_KEY) {
      try {
        const [quoteRes, profileRes] = await Promise.allSettled([
          fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(code)}&token=${FINNHUB_KEY}`, { signal: AbortSignal.timeout(4000) }),
          fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(code)}&token=${FINNHUB_KEY}`, { signal: AbortSignal.timeout(3000) }),
        ]);
        if (quoteRes.status === "fulfilled" && quoteRes.value.ok) {
          const q = await quoteRes.value.json();
          price = q.c ?? null;
          changePct = q.dp ?? null;
        }
        if (profileRes.status === "fulfilled" && profileRes.value.ok) {
          const p = await profileRes.value.json();
          name = p.name || code;
          marketCap = p.marketCapitalization ? p.marketCapitalization * 1_000_000 : null;
        }
      } catch {}
    }

    // Yahoo获取PE和fallback价格
    try {
      const yahooRes = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}?interval=1d&range=1d`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(4000) },
      );
      if (yahooRes.ok) {
        const yd = await yahooRes.json();
        const meta = yd?.chart?.result?.[0]?.meta;
        if (meta) {
          if (!price) price = meta.regularMarketPrice ?? null;
          if (!changePct) changePct = meta.regularMarketChangePercent ?? null;
          if (name === code) name = meta.longName || meta.shortName || name;
          pe = meta.trailingPE ?? null;
          if (!marketCap) marketCap = meta.marketCap ?? null;
        }
      }
    } catch {}

    return { code, name, price, pe, changePct, marketCap };
  }));
}

export function buildStockContext(
  stockData: Array<{ code: string; name: string; price: number | null; pe: number | null; changePct: number | null; marketCap: number | null }>,
): string {
  if (stockData.length === 0) return "";
  const lines = stockData.map((s) => {
    const parts = [`${s.code} (${s.name})`];
    if (s.price != null) parts.push(`价格:$${s.price}`);
    if (s.changePct != null) parts.push(`涨跌:${s.changePct}%`);
    if (s.pe != null) parts.push(`PE:${s.pe}`);
    if (s.marketCap != null) {
      const capB = s.marketCap / 1e9;
      if (capB > 1) parts.push(`市值:$${capB.toFixed(1)}B`);
    }
    return `- ${parts.join(" | ")}`;
  });
  return [
    "",
    "用户提到的股票实时数据（来自Yahoo Finance，可能延迟15-20分钟）：",
    ...lines,
    "请在分析时引用这些数据，数据缺失时标注「数据缺失」。",
  ].join("\n");
}
