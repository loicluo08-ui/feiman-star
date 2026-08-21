/**
 * 股票代码提取器 + 实时行情获取
 */

const STOCK_ALIASES: Record<string, string> = {
  "苹果": "AAPL", "英伟达": "NVDA", "特斯拉": "TSLA", "亚马逊": "AMZN",
  "微软": "MSFT", "谷歌": "GOOGL", "meta": "META", "脸书": "META",
  "网飞": "NFLX", "奈飞": "NFLX", "超微": "SMCI", "超威": "AMD", "高通": "QCOM",
  "台积电": "TSM", "阿里": "BABA", "拼多多": "PDD", "京东": "JD",
  "百度": "BIDU", "理想": "LI", "蔚来": "NIO", "小鹏": "XPEV",
  "礼来": "LLY", "联合健康": "UNH", "摩根大通": "JPM",
  "迪士尼": "DIS", "耐克": "NKE", "波音": "BA", "高盛": "GS",
  "英特尔": "INTC", "intel": "INTC", "甲骨文": "ORCL", "Adobe": "ADBE", "思科": "CSCO",
  "伯克希尔": "BRK.A", "巴菲特": "BRK.A", "美团": "MPNGY", "网易": "NTES", "携程": "TCOM",
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

  // 小写热门代码（nvda/tsla等常见输入习惯，白名单防误伤普通英文单词）
  const HOT_CODES = new Set(["AAPL","NVDA","TSLA","MSFT","GOOG","GOOGL","AMZN","META","AMD","INTC","NFLX","AVGO","TSM","BABA","PDD","JD","BIDU","NIO","XPEV","LI","COIN","MSTR","PLTR","SMCI","MU","QCOM","TXN","ARM","SOFI","RIVN","LCID","F","GM","JPM","GS","BAC","V","MA","DIS","NKE","BA","LMT","XOM","CVX","JNJ","LLY","UNH","WMT","COST","UBER","ABNB","SQ","PYPL","SHOP","SNOW","CRWD","NET","DKNG","RBLX","TTD","ROKU","ZM","PENN","FUTU","BILI","TME","IQ","VIPS","ZK","DASH","SNAP","PINS","SPOT"]);
  const lowerMatches = normalizedText.match(/(?<![a-zA-Z])([a-z]{2,5})(?![a-zA-Z])/g);
  if (lowerMatches) {
    lowerMatches.forEach((w) => {
      const up = w.toUpperCase();
      if (HOT_CODES.has(up)) codes.add(up);
    });
  }

  return Array.from(codes).slice(0, 4);
}

export async function fetchStockData(codes: string[]): Promise<Array<{
  code: string; name: string; price: number | null; pe: number | null;
  changePct: number | null; marketCap: number | null;
  previousClose: number | null; open: number | null; high: number | null; low: number | null; volume: number | null;
  freshness: string | null; divergence: number | null; anomaly: boolean;
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
    let qtValid = false;
    let qtTimestamp: string | null = null;
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
            const pPrice = parseFloat(f[3]);
            const pPrev = parseFloat(f[4]) || 0;
            const pPct = f[32] !== "" ? parseFloat(f[32]) : 0;
            const pPEraw = f[39] == null ? "" : f[39];
            const pPE = pPEraw !== "" && !isNaN(parseFloat(pPEraw)) ? parseFloat(pPEraw) : 0;
            // D2合理性闸门：零负价/异常涨跌/极端PE → 弃用走备用源
            const sane = pPrice > 0 && pPrev > 0 && Math.abs(pPct) <= 20 && (pPE === 0 || (pPE > 0 && pPE < 1000));
            if (sane) {
              qtValid = true;
              name = f[1] || name;
              price = pPrice || null;
              previousClose = pPrev || null;
              open = parseFloat(f[5]) || null;
              volume = parseFloat(f[6]) || null;
              changePct = f[32] !== "" ? pPct : null;
              high = f[33] !== "" && f[33] !== undefined ? parseFloat(f[33]) : null;
              low = f[34] !== "" && f[34] !== undefined ? parseFloat(f[34]) : null;
              pe = pPE > 0 ? pPE : null;
              marketCap = f[44] !== "" && parseFloat(f[44]) > 0 ? parseFloat(f[44]) * 1e8 : null;
              // D1新鲜度：f[30]=美东完整时间"YYYY-MM-DD HH:MM:SS"。日期不同(周末/隔夜)→收盘；同日按分钟差算年龄
              const tm = (f[30] || "").match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
              if (tm) {
                try {
                  const nowFull = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(",", "");
                  const [nDate, nTime] = nowFull.split(" ");
                  const [nh, nm] = nTime.split(":").map(Number);
                  const qDate = `${tm[1]}-${tm[2]}-${tm[3]}`;
                  const qMin = parseInt(tm[4]) * 60 + parseInt(tm[5]);
                  const nMin = nh * 60 + nm;
                  if (qDate !== nDate) {
                    // 非同一天：跨夜/周末，直接标收盘
                    qtTimestamp = `${tm[2]}/${tm[3]}收盘数据（非实时）`;
                  } else {
                    const ageMin = (nMin - qMin + 1440) % 1440;
                    qtTimestamp = ageMin < 5 ? "实时" : ageMin < 30 ? `延迟${ageMin}分钟` : `数据时间${tm[4]}:${tm[5]}美东(非实时,可能为收盘)`;
                  }
                } catch { qtTimestamp = `数据时间${tm[4]}:${tm[5]}美东`; }
              }
            }
          }
        }
      }
    } catch {}

    // Finnhub交叉/兜底（腾讯失败时兜底供数；腾讯成功时只做D3分歧检测）+ D3跨源分歧检测
    let fhPrice: number | null = null;
    if (FINNHUB_KEY) {
      try {
        const [quoteRes, profileRes] = await Promise.allSettled([
          fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(code)}&token=${FINNHUB_KEY}`, { signal: AbortSignal.timeout(4000) }),
          fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(code)}&token=${FINNHUB_KEY}`, { signal: AbortSignal.timeout(3000) }),
        ]);
        if (quoteRes.status === "fulfilled" && quoteRes.value.ok) {
          const q = await quoteRes.value.json();
          fhPrice = q.c ?? null;
          if (!qtValid) {
            price = fhPrice;
            previousClose = q.pc ?? null;
            if (changePct == null) changePct = q.dp ?? null;
          }
        }
        if (!qtValid && profileRes.status === "fulfilled" && profileRes.value.ok) {
          const p = await profileRes.value.json();
          if (name === code) name = p.name || code;
          if (marketCap == null) marketCap = p.marketCapitalization ? p.marketCapitalization * 1_000_000 : null;
        }
      } catch {}
    }
    // D3：两源都拿到时算分歧
    let divergence: number | null = null;
    if (qtValid && fhPrice != null && fhPrice > 0 && price != null) {
      const dv = Math.abs(price - fhPrice) / fhPrice * 100;
      if (dv > 0.5) divergence = dv;
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

    return { code, name, price, pe, changePct, marketCap, previousClose, open, high, low, volume, freshness: qtTimestamp, divergence, anomaly: !qtValid && price != null };
  }));
}

export function buildStockContext(
  stockData: Array<{ code: string; name: string; price: number | null; pe: number | null; changePct: number | null; marketCap: number | null; previousClose: number | null; open: number | null; high: number | null; low: number | null; volume: number | null; freshness: string | null; divergence: number | null; anomaly: boolean }>,
): string {
  if (stockData.length === 0) return "";
  const lines = stockData.map((s) => {
    const parts = [`${s.code} (${s.name})`];
    if (s.price == null) {
      // D5：单只获取失败明确标注，模型才知道这只走降级
      parts.push(`[获取失败，无有效数据。执行D5：明说该股数据缺失，可用知识库定性分析，禁止编造数字]`);
      return `- ${parts.join(" | ")}`;
    }
    if (s.freshness) parts.push(`[${s.freshness}]`);
    if (s.anomaly) parts.push(`[数据异常，经备用源校正]`);
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
    if (s.divergence != null) parts.push(`[两源分歧±${s.divergence.toFixed(2)}%，腾讯vs Finnhub，须呈现两值]`);
    return `- ${parts.join(" | ")}`;
  });
  return [
    "",
    `用户提到的股票实时数据（腾讯行情主源+Finnhub交叉，${new Date().toLocaleString("zh-CN", { timeZone: "America/New_York", hour12: false })} 美东时间）：`,
    ...lines,
    "涨跌幅计算基准为昨收。执行S1展示算式、D1保留新鲜度标注、D2异常标注不可抹除、D3有分歧标注时必须呈现两源数字。数据未提供的字段写「数据缺失」，禁止编造（S2/D2）。",
  ].join("\n");
}
