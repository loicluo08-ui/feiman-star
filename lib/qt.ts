/**
 * 腾讯行情数据源（qt.gtimg.cn）
 *
 * 免费、无认证、实时（与富途/券商同秒级）。美股 us+代码，港股 hk+代码，A股 sh/sz前缀。
 * 响应为GBK编码的 v_usNVDA="200~英伟达~NVDA.OQ~216.60~..." 格式（~分隔字段）。
 *
 * 字段表（美股，索引从0）：
 * 1=名称 2=代码 3=现价 4=昨收 5=今开 6=成交量(股)
 * 30=时间(美东) 31=涨跌 32=涨跌% 33=最高 34=最低
 * 36=成交量(股,重复) 37=成交额(美元) 38=换手率 39=PE 44=总市值(美元)
 * 注意：美股无pb字段（A股在46），pb返回null由Finnhub兜底
 */

const QT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export interface QtStock {
  code: string;
  name: string;
  price: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  turnover: number | null;
  pe: number | null;
  pb: number | null;
  marketCap: number | null;
  time: string | null;
}

function num(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

/** GBK解码：Node 22内置full-icu，TextDecoder("gbk")可用 */
function decodeGbk(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
}

function parseQtLine(line: string): QtStock | null {
  const m = line.match(/v_(\w+)="([^"]*)"/);
  if (!m) return null;
  const code = m[1];
  const f = m[2].split("~");
  if (f.length < 40) return null;
  return {
    code,
    name: f[1] || "",
    price: num(f[3]),
    previousClose: num(f[4]),
    open: num(f[5]),
    high: num(f[33]),
    low: num(f[34]),
    change: num(f[31]),
    changePct: num(f[32]),
    volume: num(f[6]),
    turnover: num(f[37]),
    pe: num(f[39]),
    pb: null,
    marketCap: num(f[44]),
    time: f[30] || null,
  };
}

/** 批量获取美股行情（symbol数组，如 ["NVDA","AAPL"]）。失败返回空Map */
export async function getQtStocks(symbols: string[]): Promise<Map<string, QtStock>> {
  const out = new Map<string, QtStock>();
  if (symbols.length === 0) return out;
  try {
    const codes = symbols.slice(0, 30).map((s) => `us${s}`).join(",");
    const res = await fetch(`https://qt.gtimg.cn/q=${codes}`, {
      headers: { "User-Agent": QT_UA, Referer: "https://gu.qq.com/" },
      signal: AbortSignal.timeout(8000),
    });
    const text = decodeGbk(await res.arrayBuffer());
    for (const line of text.split(";")) {
      const q = parseQtLine(line.trim());
      if (q && q.price != null) out.set(q.code.replace(/^us/, ""), q);
    }
  } catch {
    // 静默失败，调用方走兜底
  }
  return out;
}

/** 单只股票（价格字段为null表示不可用，调用方降级） */
export async function getQtStock(symbol: string): Promise<QtStock | null> {
  const m = await getQtStocks([symbol]);
  return m.get(symbol) ?? null;
}
