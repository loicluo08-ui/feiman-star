/**
 * stockanalysis.com 数据层（2026-08-23 接入）
 *
 * 背景：Yahoo Finance 对 Vercel 出口 IP 全面 429 限流（query1/query2 实测均挂），
 * 实时行情主源已切腾讯 qt.gtimg.cn，本模块补齐两类 Yahoo 兜底能力：
 *   1. 日线收盘价（板块5d/20d、个股K线）
 *   2. 股票搜索（代码+名称+类型）
 *
 * 实测：无认证、无JS挑战、云端直连200，日线含全部历史（NVDA 6900+天）。
 * 礼貌使用：调用方必须自带缓存（market-pulse 已有60分钟closesCache）。
 */

const SA_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Yahoo 用 BRK-A，SA 用 BRK.B——统一转成 SA 格式 */
export function toSASymbol(code: string): string {
  // BRK-A → BRK.B（Yahoo 横线后缀转点号）；BRK.B 本身不动
  const m = code.match(/^([A-Z]+)-([A-Z])$/);
  if (m) return `${m[1]}.${m[2]}`;
  return code.toUpperCase();
}

/** SA 日线返回 [timestampMs, close]，转成纯收盘价数组（升序，最新在末尾） */
export async function fetchSACloses(rawCode: string, maxDays = 120): Promise<number[]> {
  const rows = await fetchSADaily(rawCode, maxDays);
  return rows.map((r) => r.close);
}

/** SA 日线：返回 {date, close}[]（升序），date为 YYYY-MM-DD（美东），供K线图使用 */
export async function fetchSADaily(
  rawCode: string,
  maxDays = 120,
): Promise<Array<{ date: string; close: number; volume: number | null }>> {
  const symbol = toSASymbol(rawCode);
  try {
    const res = await fetch(
      `https://stockanalysis.com/api/symbol/s/${encodeURIComponent(symbol)}/history?type=chart`,
      {
        headers: {
          "User-Agent": SA_UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://stockanalysis.com/",
        },
        signal: AbortSignal.timeout(9000),
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { status?: number; data?: Array<[number, number]> };
    const rows = Array.isArray(json?.data) ? json.data : [];
    const daily = rows
      .filter((r) => Array.isArray(r) && typeof r[1] === "number" && r[1] > 0)
      .map((r) => ({
        date: new Date(r[0]).toISOString().slice(0, 10),
        close: r[1],
        volume: null,
      }));
    return daily.length > maxDays ? daily.slice(daily.length - maxDays) : daily;
  } catch {
    return [];
  }
}

/** SA日线 → YahooChartResult形状适配器（chat历史锚点等消费方无缝切换） */
export async function fetchSAYahooLikeChart(
  rawCode: string,
  maxDays = 90,
): Promise<{ timestamp: number[]; indicators: { quote: Array<{ close: Array<number | null> }> } } | null> {
  const rows = await fetchSADaily(rawCode, maxDays);
  if (rows.length === 0) return null;
  return {
    timestamp: rows.map((r) => new Date(r.date + "T00:00:00Z").getTime() / 1000),
    indicators: { quote: [{ close: rows.map((r) => r.close) }] },
  };
}

export interface SASearchResult {
  code: string;
  name: string;
  exchange: string | null;
  type: string;
}

/** 搜索兜底：返回 [{code, name, type}]，t: s=股票 e=ETF */
export async function saSearch(q: string): Promise<SASearchResult[]> {
  const query = q.trim();
  if (!query) return [];
  try {
    const res = await fetch(
      `https://stockanalysis.com/api/search?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": SA_UA,
          Accept: "application/json, text/plain, */*",
          Referer: "https://stockanalysis.com/",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      status?: number;
      data?: Array<{ id?: string; s?: string; t?: string; n?: string }>;
    };
    const rows = Array.isArray(json?.data) ? json.data : [];
    return rows.slice(0, 8).map((r) => {
      const rawType = r.t === "e" ? "etf" : "stock";
      // SA 返回 BRK.B 形态，对外统一转腾讯/Yahoo兼容的 BRK.A 点号格式（qt.gtimg.cn 实测只认点号）
      const code = (r.s || r.id || "").replace(/-([A-Z])$/, ".$1");
      return { code, name: r.n || code, exchange: null, type: rawType };
    });
  } catch {
    return [];
  }
}
