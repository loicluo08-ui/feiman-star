/**
 * SEC EDGAR 官方财报原文层——免费免key（需User-Agent声明身份+联系邮箱，10 req/s限流）
 * https://data.sec.gov/submissions/CIK{cik10}.json + company_tickers.json映射
 * 用途：财报问题注入"官方原文锚"——最新10-K/10-Q/8-K的form/日期/原文URL，
 *       让财务数字可回溯到SEC原文而非媒体转述（判据可核验哲学：引用能落到原始文件）
 * 纪律：低频调用（每次chat最多1次）；失败返回null静默降级
 */

const EDGAR_TICKERS = "https://www.sec.gov/files/company_tickers.json";
const EDGAR_SUBMISSIONS = "https://data.sec.gov/submissions";
const HEADERS = { "User-Agent": "FeimanStar Research admin@feimanstar.com" };

interface TickerMap {
  [key: string]: { cik_str: number; ticker: string; title: string };
}

let tickerCache: { map: Map<string, number>; expiresAt: number } | null = null;

/** ticker→CIK映射（官方文件，24h缓存） */
export async function getTickerCikMap(): Promise<Map<string, number> | null> {
  if (tickerCache && tickerCache.expiresAt > Date.now()) return tickerCache.map;
  try {
    const res = await fetch(EDGAR_TICKERS, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as TickerMap;
    const map = new Map<string, number>();
    for (const v of Object.values(data)) map.set(v.ticker.toUpperCase(), v.cik_str);
    tickerCache = { map, expiresAt: Date.now() + 24 * 3600 * 1000 };
    return map;
  } catch {
    return null;
  }
}

export interface EdgarFiling {
  form: string;
  filedDate: string;
  url: string;
}

/** 最新年报/季报/重大事件申报（10-K/10-Q/8-K各取最新一条） */
export async function getEdgarFilings(symbol: string): Promise<{ cik: number; filings: EdgarFiling[] } | null> {
  const map = await getTickerCikMap();
  if (!map) return null;
  const cik = map.get(symbol.toUpperCase());
  if (!cik) return null;
  const cik10 = String(cik).padStart(10, "0");
  try {
    const res = await fetch(`${EDGAR_SUBMISSIONS}/CIK${cik10}.json`, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { filings?: { recent?: { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] } } };
    const recent = data.filings?.recent;
    if (!recent) return null;
    const wanted = new Set(["10-K", "10-Q", "8-K"]);
    const seen = new Set<string>();
    const filings: EdgarFiling[] = [];
    for (let i = 0; i < recent.form.length && filings.length < 3; i++) {
      const form = recent.form[i];
      if (!wanted.has(form) || seen.has(form)) continue;
      seen.add(form);
      const accNo = recent.accessionNumber[i].replace(/-/g, "");
      const doc = recent.primaryDocument[i];
      filings.push({
        form,
        filedDate: recent.filingDate[i],
        url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accNo}/${doc}`,
      });
    }
    return filings.length > 0 ? { cik, filings } : null;
  } catch {
    return null;
  }
}

/** 注入块：SEC原文锚（财务数字可回溯到官方申报文件） */
export async function buildEdgarBlock(symbol: string): Promise<string> {
  const r = await getEdgarFilings(symbol);
  if (!r) return "";
  const rows = r.filings.map((f) => `${f.form}（${f.filedDate}申报）`).join("、");
  const tenQ = r.filings.find((f) => f.form === "10-Q") ?? r.filings.find((f) => f.form === "10-K");
  const link = tenQ ? `最新季报/年报原文：${tenQ.url}` : "";
  return `【SEC原文锚】${rows}——财务数字引用优先对齐SEC申报原文，媒体口径为二手。${link}`;
}
