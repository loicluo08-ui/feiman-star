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

// 从chart结果提取历史锚点（1月前/3月前/近1月高低），供chat注入
export function extractHistoryAnchors(
  chart: YahooChartResult | null,
): { oneMonthAgo: number | null; threeMonthsAgo: number | null; monthHigh: number | null; monthLow: number | null; } | null {
  if (!chart) return null;
  const closes = (chart.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => c != null);
  if (closes.length < 30) return null;
  const last20 = closes.slice(-21, -1); // 最近一个月约21个交易日
  return {
    oneMonthAgo: closes[closes.length - 22] ?? null,
    threeMonthsAgo: closes[0] ?? null,
    monthHigh: last20.length ? Math.max(...last20) : null,
    monthLow: last20.length ? Math.min(...last20) : null,
  };
}
