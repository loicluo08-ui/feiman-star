// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Yahoo chart 共享库（chat历史锚点 + stock详情页K线统一实现）
// 线上验证过的组合：导航型浏览器指纹 + query2/query1双host容灾
// 注意：Sec-Fetch-Dest必须用document（导航型），用empty/cors（XHR型）会被限流
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type YahooChartResult = {
  meta?: {
    instrumentType?: string;
    longName?: string;
    shortName?: string;
    exchangeName?: string;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketVolume?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
};

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Referer": "https://finance.yahoo.com/",
};

export async function getYahooChart(code: string, range = "3mo"): Promise<YahooChartResult | null> {
  // 带点代码（BRK.A）在Yahoo是横杠（BRK-A）
  const yahooCode = code.replace(".", "-");

  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    try {
      const response = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(yahooCode)}?interval=1d&range=${range}`,
        { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        chart?: { result?: YahooChartResult[]; error?: { code?: string; description?: string } };
      };
      if (payload.chart?.result?.[0]) {
        return payload.chart.result[0];
      }
    } catch {
      // 继续尝试下一host
    }
  }
  return null;
}

// 从chart结果提取历史锚点，供chat注入。
// 纵深设计（9/6输出质量优化）：1月/3月/6月前价格+近1月高低+52周高低+YTD起点+近20日均量
// ——"年内表现/距52周高点回撤多少/放量还是缩量"类问题是深度分析刚需，缺锚点时AI只能弃答
// 索引规则：从最后一个有效收盘往回数交易日（3mo数据源下降级自动缺锚，字段null，模型按D2走"数据未注入"路径）
export interface HistoryAnchors {
  oneMonthAgo: number | null;
  threeMonthsAgo: number | null;
  sixMonthsAgo: number | null;
  monthHigh: number | null;
  monthLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  ytdStart: number | null;
  avgVolume20: number | null;
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
}

export function extractHistoryAnchors(chart: YahooChartResult | null): HistoryAnchors | null {
  if (!chart) return null;
  const quote = chart.indicators?.quote?.[0];
  const rawCloses = quote?.close ?? [];
  const rawVolumes = quote?.volume ?? [];
  const timestamps = chart.timestamp ?? [];
  if (rawCloses.length < 30) return null;

  // 最后一个有效收盘索引（不filter整数组——filter后与timestamp索引漂移，YTD定位会错位）
  let lastIdx = -1;
  for (let i = rawCloses.length - 1; i >= 0; i--) {
    if (rawCloses[i] != null) { lastIdx = i; break; }
  }
  if (lastIdx < 29) return null;

  const closeAt = (tradingDaysBack: number): number | null => {
    const idx = lastIdx - tradingDaysBack;
    if (idx < 0) return null;
    const v = rawCloses[idx];
    return typeof v === "number" ? v : null;
  };

  // 近1月高低：最近约21根已收K线（不含最新跳动价，保持原语义）
  const last20: number[] = [];
  for (let i = Math.max(0, lastIdx - 20); i < lastIdx; i++) {
    const v = rawCloses[i];
    if (typeof v === "number") last20.push(v);
  }

  // 52周高低：meta自带（Yahoo全区间高低，最准）优先；缺失时1y数据可用closes近似，否则null
  const meta = chart.meta ?? {};
  const w52High = typeof meta.fiftyTwoWeekHigh === "number" ? meta.fiftyTwoWeekHigh
    : (lastIdx >= 199 ? Math.max(...rawCloses.slice(lastIdx - 250, lastIdx + 1).filter((c): c is number => c != null)) : null);
  const w52Low = typeof meta.fiftyTwoWeekLow === "number" ? meta.fiftyTwoWeekLow
    : (lastIdx >= 199 ? Math.min(...rawCloses.slice(lastIdx - 250, lastIdx + 1).filter((c): c is number => c != null)) : null);

  // YTD起点：从最新往回找第一个落在去年（ts < 当年1月1日UTC）的K线，其后第一根=今年首个收盘
  // 交易日ts与UTC年初的比较误差最多1个交易日，对"年初至今涨跌"锚点无实质影响
  const yearStartSec = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
  let ytdIdx = 0;
  for (let i = lastIdx; i >= 0; i--) {
    const ts = timestamps[i];
    if (typeof ts !== "number" || ts < yearStartSec) { ytdIdx = Math.min(i + 1, lastIdx); break; }
  }
  const ytdStartRaw = rawCloses[ytdIdx];
  const ytdStart = typeof ytdStartRaw === "number" ? ytdStartRaw : null;

  // 近20日均量：量能基线——当日量 vs 均量，放量/缩量判断从"无基线"变"有基线"
  const vols: number[] = [];
  for (let i = lastIdx; i >= 0 && vols.length < 20; i--) {
    const v = rawVolumes[i];
    if (typeof v === "number" && v > 0) vols.push(v);
  }
  const avgVolume20 = vols.length >= 10 ? vols.reduce((a, b) => a + b, 0) / vols.length : null;

  // MA价格均线（9/6质量优化）：现价vs均线位置是多头/空头排列判断的直接锚——
  // 基线实测AI自报"20日均线[数据缺失]"，而日线数据已拉到本地，只差没算。
  // 含最新K线（盘中=即时均线，标准实时图表口径）；数据不足宁null（模型按D2走缺数据路径）
  const maAt = (n: number): number | null => {
    if (lastIdx + 1 < n) return null;
    let sum = 0;
    for (let i = lastIdx; i > lastIdx - n; i--) {
      const v = rawCloses[i];
      if (typeof v !== "number") return null;
      sum += v;
    }
    return sum / n;
  };

  return {
    oneMonthAgo: closeAt(21),
    threeMonthsAgo: closeAt(63),
    sixMonthsAgo: closeAt(126),
    monthHigh: last20.length ? Math.max(...last20) : null,
    monthLow: last20.length ? Math.min(...last20) : null,
    fiftyTwoWeekHigh: w52High,
    fiftyTwoWeekLow: w52Low,
    ytdStart,
    avgVolume20,
    ma20: maAt(20),
    ma50: maAt(50),
    ma200: maAt(200),
  };
}
