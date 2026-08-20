/**
 * 富途行情数据源（futunn.com SSR）
 *
 * 原理：富途WAF盾页(约10KB)的JS字符串表内嵌预签名wafToken JWT。
 * 两步请求纯HTTP完成，无需浏览器：
 *   1. 裸请求盾页 -> 正则提取内嵌JWT（对当前出口IP有效，30分钟）
 *   2. 带 wafToken cookie 请求行情页 -> 解析 window.__INITIAL_STATE__ 的 stockInfo
 *
 * 注意：token绑定出口IP，Vercel多实例各自独立过盾，模块级缓存30分钟有效期内复用。
 */

const FUTU_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

/** 模块级token缓存（单实例内有效，与金十快讯5分钟缓存同模式） */
let cachedToken: { token: string; expireAt: number } | null = null;

/** 提取盾页内嵌的wafToken。失败返回null（调用方降级到Yahoo/Finnhub） */
async function fetchWafToken(): Promise<string | null> {
  try {
    const res = await fetch("https://www.futunn.com/stock/AAPL-US", {
      headers: { "User-Agent": FUTU_UA, Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    // 盾页特征：体积小 + 内嵌JWT。若直接返回完整页（IP已被信任）也能从这里提取到
    const jwts = html.match(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g);
    if (!jwts) return null;
    // 取最长的JWT候选（wafToken是页内最长签名串）
    const token = jwts.sort((a, b) => b.length - a.length)[0];
    return token.length > 100 ? token : null;
  } catch {
    return null;
  }
}

/** 获取有效wafToken（带缓存，25分钟刷新避免30分钟过期） */
export async function getFutuToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expireAt) return cachedToken.token;
  const token = await fetchWafToken();
  if (token) {
    cachedToken = { token, expireAt: now + 25 * 60 * 1000 };
    return token;
  }
  cachedToken = null;
  return null;
}

export interface FutuStockInfo {
  code: string;
  name: string | null;
  price: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  /** 成交量（股） */
  volume: number | null;
  /** 成交额（美元） */
  turnover: number | null;
  peTtm: number | null;
  peLyr: number | null;
  pb: number | null;
  /** 总市值（美元） */
  marketCap: number | null;
  eps: number | null;
  /** 数据时间戳（毫秒） */
  dataTime: number | null;
}

/** 解析富途中文带单位数字："3366.73万" -> 33667300；"73.34亿" -> 7334000000 */
export function parseCnNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = raw.match(/([\d.]+)\s*(万亿|亿|万)?/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (Number.isNaN(num)) return null;
  const unit = m[2];
  if (unit === "万亿") return num * 1e12;
  if (unit === "亿") return num * 1e8;
  if (unit === "万") return num * 1e4;
  return num;
}

/** 从SSR页面HTML提取stock_info JSON块（key为下划线格式 stock_info） */
function extractStockInfo(html: string, code: string): Record<string, string> | null {
  const anchor = `"${code}"`;
  const idx = html.indexOf(anchor);
  if (idx < 0) return null;
  const region = html.slice(Math.max(0, idx - 2500), idx + 5000);
  const blockMatch = region.match(/"stock_info"\s*:\s*\{([\s\S]{200,8000}?)\}\s*,\s*"/);
  if (!blockMatch) return null;
  const body = blockMatch[1];
  // 提取 "key":"value" 对（Array.from兼容es5 target，for...of iterator需downlevelIteration）
  const info: Record<string, string> = {};
  const pairRegex = /"([a-zA-Z_]+)"\s*:\s*"([^"]*)"/g;
  let p: RegExpExecArray | null;
  while ((p = pairRegex.exec(body)) !== null) {
    if (!(p[1] in info)) info[p[1]] = p[2];
  }
  return info.priceNominal ? info : null;
}

/** 抓单只美股实时行情（富途SSR）。任何失败返回null，调用方降级 */
export async function getFutuStock(code: string): Promise<FutuStockInfo | null> {
  try {
    const token = await getFutuToken();
    if (!token) return null;

    const res = await fetch(`https://www.futunn.com/stock/${encodeURIComponent(code)}-US`, {
      headers: {
        "User-Agent": FUTU_UA,
        Accept: "text/html",
        Cookie: `wafToken=${token}`,
        "Accept-Language": "zh-cn,zh;q=0.9",
      },
      signal: AbortSignal.timeout(9000),
    });
    const html = await res.text();
    if (html.length < 100_000) return null; // 被盾拦截（盾页约10KB）

    const info = extractStockInfo(html, code);
    if (!info) return null;

    const num = (v: string | undefined) => (v != null && v !== "" ? parseFloat(v) : null);
    const validNum = (v: number | null) => (v != null && Number.isFinite(v) ? v : null);

    return {
      code,
      name: info.name || null,
      price: validNum(num(info.priceNominal)),
      previousClose: validNum(num(info.priceLastClose)),
      open: validNum(num(info.priceOpen)),
      high: validNum(num(info.priceHighest)),
      low: validNum(num(info.priceLowest)),
      volume: parseCnNumber(info.volume),
      turnover: parseCnNumber(info.turnover),
      peTtm: validNum(num(info.peTtm)),
      peLyr: validNum(num(info.peLyr)),
      pb: validNum(num(info.pbRatio)),
      marketCap: parseCnNumber(info.totalMarketCap),
      eps: validNum(num(info.epsTtm) ?? num(info.epsLyr)),
      dataTime: num(info.serverSendToClientTimeMs),
    };
  } catch {
    return null;
  }
}
