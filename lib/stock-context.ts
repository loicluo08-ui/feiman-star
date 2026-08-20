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
  previousClose: number | null; open: number | null; high: number | null; low: number | null; volume: number | null;
}>> {
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

  return Promise.all(codes.map(async (code) => {
    let price: number | null = null;
    let changePct: number | null = null;
    let name = code;
    let marketCap: number | null = null;
    let pe: number | null = null;
    let previousClose: number | null = null;
    let open: number | null = null;
    let high: number | null = null;
    let low: number | null = null;
    let volume: number | null = null;

    // 腾讯源优先（实时+全套字段+免认证）
    try {
      const qtRes = await fetch(`https://qt.gtimg.cn/q=us${encodeURIComponent(code)}`, {
        headers: { "User-Agent": UA, Referer: "https://gu.qq.com/" },
        signal: AbortSignal.timeout(5000),
      });
      if (qtRes.ok) {
        const raw = new TextDecoder("gbk").decode(await qtRes.arrayBuffer());
        const m = raw.match(/"[^"]*"/);
        if (m) {
          const f = m[0].slice(1, -1).split("~");
          if (f.length > 44 && parseFloat(f[3]) > 0) {
            name = f[1] || name;
            price = parseFloat(f[3]) || null;
            previousClose = parseFloat(f[4]) || null;
            open = parseFloat(f[5]) || null;
            volume = parseFloat(f[6]) || null;
            changePct = f[32] != null && f[32] !== "" ? parseFloat(f[32]) : null;
            high = f[33] != null && f[33] !== "" ? parseFloat(f[33]) : null;
            low = f[34] != null && f[34] !== "" ? parseFloat(f[34]) : null;
            pe = f[39] != null && f[39] !== "" && parseFloat(f[39]) > 0 ? parseFloat(f[39]) : null;
            marketCap = f[44] != null && f[44] !== "" && parseFloat(f[44]) > 0 ? parseFloat(f[44]) : null;
          }
        }
      }
    } catch {}

    // Finnhub兜底（腾讯失败时）
    if (price == null && FINNHUB_KEY) {
      try {
        const [quoteRes, profileRes] = await Promise.allSettled([
          fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(code)}&token=${FINNHUB_KEY}`, { signal: AbortSignal.timeout(4000) }),
          fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(code)}&token=${FINNHUB_KEY}`, { signal: AbortSignal.timeout(3000) }),
        ]);
        if (quoteRes.status === "fulfilled" && quoteRes.value.ok) {
          const q = await quoteRes.value.json();
          price = q.c ?? null;
          previousClose = q.pc ?? null;
          if (changePct == null) changePct = q.dp ?? null;
        }
        if (profileRes.status === "fulfilled" && profileRes.value.ok) {
          const p = await profileRes.value.json();
          if (name === code) name = p.name || code;
          if (marketCap == null) marketCap = p.marketCapitalization ? p.marketCapitalization * 1_000_000 : null;
        }
      } catch {}
    }

    // Yahoo最后兜底
    if (price == null) {
      try {
        const yahooRes = await fetch(
          `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}?interval=1d&range=1d`,
          { headers: { "User-Agent": UA, Referer: "https://finance.yahoo.com/" }, signal: AbortSignal.timeout(4000) },
        );
        if (yahooRes.ok) {
          const yd = await yahooRes.json();
          const meta = yd?.chart?.result?.[0]?.meta;
          if (meta) {
            price = meta.regularMarketPrice ?? null;
            previousClose = meta.chartPreviousClose ?? previousClose;
            if (changePct == null) changePct = meta.regularMarketChangePercent ?? null;
            if (name === code) name = meta.longName || meta.shortName || name;
            if (pe == null) pe = meta.trailingPE ?? null;
            if (marketCap == null) marketCap = meta.marketCap ?? null;
          }
        }
      } catch {}
    }

    return { code, name, price, pe, changePct, marketCap, previousClose, open, high, low, volume };
  }));
}

export function buildStockContext(
  stockData: Array<{ code: string; name: string; price: number | null; pe: number | null; changePct: number | null; marketCap: number | null; previousClose: number | null; open: number | null; high: number | null; low: number | null; volume: number | null }>,
): string {
  if (stockData.length === 0) return "";
  const lines = stockData.map((s) => {
    const parts = [`${s.code} (${s.name})`];
    if (s.price != null) parts.push(`现价:$${s.price}`);
    if (s.previousClose != null) parts.push(`昨收:$${s.previousClose}`);
    if (s.changePct != null) parts.push(`涨跌:${s.changePct}%`);
    if (s.open != null) parts.push(`开:$${s.open}`);
    if (s.high != null) parts.push(`高:$${s.high}`);
    if (s.low != null) parts.push(`低:$${s.low}`);
    if (s.volume != null) parts.push(`量:${(s.volume / 1e6).toFixed(2)}亿股`);
    if (s.pe != null) parts.push(`PE:${s.pe}`);
    if (s.marketCap != null) {
      const capB = s.marketCap / 1e9;
      if (capB > 1) parts.push(`市值:$${capB.toFixed(0)}B`);
    }
    return `- ${parts.join(" | ")}`;
  });
  return [
    "",
    `用户提到的股票实时数据（腾讯行情，${new Date().toLocaleString("zh-CN", { timeZone: "America/New_York", hour12: false })} 美东时间）：`,
    ...lines,
    "涨跌幅计算基准为昨收。请在分析时引用这些数据并展示算式（S1）。数据未提供的字段写「数据缺失」，禁止编造。",
  ].join("\n");
}
