/**
 * 商品/加密行情上下文（10/17 逸翔"要"令扩展：对话能报币价/贵金属/商品期货）
 *
 * 覆盖标的与口径（Yahoo Finance v8 chart，与stock-context同源同栈）：
 * - 加密主流币：BTC-USD / ETH-USD（现货聚合价，24/7无休市）
 * - 贵金属：GC=F(COMEX黄金主力) / SI=F(COMEX白银主力)
 * - 能源：CL=F(WTI原油) / BZ=F(布伦特原油) / NG=F(天然气)
 * - 工业金属：HG=F(COMEX铜)
 * - 汇率指数：DX-Y.NYB(美元指数)
 *
 * 设计约束：
 * - 复用lib/yahoo-chart的getYahooChart（同一UA/超时/解析栈，零新依赖）
 * - 进程内5分钟缓存（行情分钟级新鲜度无损；Yahoo免费接口限流保护）
 * - 未覆盖品种不编造：识别到未覆盖币/商品时调用方注入数据边界声明（chat route）
 * - 识别宁宽勿严：比喻误触发成本=多注入一段价格块（无害），漏触发成本=AI说拿不到（伤用户）
 */

import { getYahooChart } from "./yahoo-chart";

export interface CommodityQuote {
  symbol: string;          // Yahoo符号（GC=F / BTC-USD）
  name: string;            // 显示名（COMEX黄金主力）
  category: "metal" | "energy" | "crypto" | "fx";
  price: number;
  prevClose: number;
  changePct: number;       // 相对昨收/前结算，%
  basis: "prevClose" | "windowClose";  // 涨跌基准口径：prevClose=上一交易日收盘（准）；windowClose=5日窗口前值（previousClose缺失时的诚实降级，标注防口径漂移）
  ts: number;              // 行情时间戳（秒）
}

type CommodityDef = { symbol: string; name: string; category: CommodityQuote["category"] };

// ── 别名表：中文/英文/俗称 → Yahoo符号。修改时同步底部注释的覆盖范围声明 ──
const COMMODITY_ALIASES: Record<string, CommodityDef> = {
  // 贵金属
  "黄金": { symbol: "GC=F", name: "COMEX黄金主力", category: "metal" },
  "金价": { symbol: "GC=F", name: "COMEX黄金主力", category: "metal" },
  "黄金现货": { symbol: "GC=F", name: "COMEX黄金主力", category: "metal" },
  "黄金期货": { symbol: "GC=F", name: "COMEX黄金主力", category: "metal" },
  "xau": { symbol: "GC=F", name: "COMEX黄金主力", category: "metal" },
  "xauusd": { symbol: "GC=F", name: "COMEX黄金主力", category: "metal" },
  "gold": { symbol: "GC=F", name: "COMEX黄金主力", category: "metal" },
  "白银": { symbol: "SI=F", name: "COMEX白银主力", category: "metal" },
  "银价": { symbol: "SI=F", name: "COMEX白银主力", category: "metal" },
  "silver": { symbol: "SI=F", name: "COMEX白银主力", category: "metal" },
  // 能源
  "原油": { symbol: "CL=F", name: "WTI原油", category: "energy" },
  "油价": { symbol: "CL=F", name: "WTI原油", category: "energy" },
  "石油": { symbol: "CL=F", name: "WTI原油", category: "energy" },
  "wti": { symbol: "CL=F", name: "WTI原油", category: "energy" },
  "布伦特": { symbol: "BZ=F", name: "布伦特原油", category: "energy" },
  "brent": { symbol: "BZ=F", name: "布伦特原油", category: "energy" },
  "天然气": { symbol: "NG=F", name: "天然气期货", category: "energy" },
  // 工业金属
  "铜": { symbol: "HG=F", name: "COMEX铜主力", category: "metal" },
  "铜价": { symbol: "HG=F", name: "COMEX铜主力", category: "metal" },
  "copper": { symbol: "HG=F", name: "COMEX铜主力", category: "metal" },
  // 汇率指数
  "美元指数": { symbol: "DX-Y.NYB", name: "美元指数DXY", category: "fx" },
  "dxy": { symbol: "DX-Y.NYB", name: "美元指数DXY", category: "fx" },
  // 加密主流币（与stock-context CRYPTO_ALIASES口径一致，此处为正向拉价）
  "比特币": { symbol: "BTC-USD", name: "比特币BTC", category: "crypto" },
  "大饼": { symbol: "BTC-USD", name: "比特币BTC", category: "crypto" },
  "btc": { symbol: "BTC-USD", name: "比特币BTC", category: "crypto" },
  "bitcoin": { symbol: "BTC-USD", name: "比特币BTC", category: "crypto" },
  "以太坊": { symbol: "ETH-USD", name: "以太坊ETH", category: "crypto" },
  "以太币": { symbol: "ETH-USD", name: "以太坊ETH", category: "crypto" },
  "eth": { symbol: "ETH-USD", name: "以太坊ETH", category: "crypto" },
  "ethereum": { symbol: "ETH-USD", name: "以太坊ETH", category: "crypto" },
};

// 比喻/术语排除：这些词组里的"黄金/白银/油/铜"不是行情询问（误注入无害但省一段token+防AI被带偏）
const METAPHOR_PATTERN = /黄金坑|黄金时代|黄金期|黄金窗口|黄金时段|黄金标准|黄金分割|黄金档|白银时代|加油|奶油|石油美元体系|青铜/g;

// 英文裸符号独立词匹配已在上循环内实现（动态正则含(?<![a-z0-9])…(?![a-z0-9])词边界，
// "eth"不匹配"ethereum"、"gold"不匹配"golden"——独立正则变量为冗余已删）
export function extractCommodityQueries(text: string): string[] {
  const cleaned = text.replace(METAPHOR_PATTERN, " ");
  const found = new Map<string, CommodityDef>();

  const lower = cleaned.toLowerCase();
  for (const [alias, def] of Object.entries(COMMODITY_ALIASES)) {
    const isAscii = /^[a-z0-9]+$/.test(alias);
    if (isAscii) {
      // 英文别名走独立词边界匹配
      const re = new RegExp(`(?<![a-z0-9])${alias}(?![a-z0-9])`, "i");
      if (re.test(lower)) found.set(def.symbol, def);
    } else if (cleaned.includes(alias)) {
      found.set(def.symbol, def);
    }
  }
  return Array.from(found.keys()).slice(0, 6);
}

// 进程内缓存：行情分钟级新鲜度，5分钟TTL防打穿Yahoo免费接口
const quoteCache = new Map<string, { data: CommodityQuote; at: number }>();
const QUOTE_CACHE_TTL = 5 * 60 * 1000;

export async function fetchCommodityData(symbols: string[]): Promise<CommodityQuote[]> {
  const now = Date.now();
  const results: CommodityQuote[] = [];

  await Promise.all(
    symbols.map(async (sym) => {
      const hit = quoteCache.get(sym);
      if (hit && now - hit.at < QUOTE_CACHE_TTL) {
        results.push(hit.data);
        return;
      }
      try {
        const chart = await getYahooChart(sym, "5d");
        const meta = chart?.meta as
          | { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number }
          | undefined;
        const price = meta?.regularMarketPrice;
        const prev = meta?.previousClose ?? meta?.chartPreviousClose;
        if (typeof price !== "number" || !isFinite(price) || price <= 0) return;
        // Yahoo v8 1d range时previousClose常缺——chartPreviousClose是5d窗口首日前收，口径=近5日基准，比缺省0诚实
        const base = typeof prev === "number" && prev > 0 ? prev : price;
        const q: CommodityQuote = {
          symbol: sym,
          name: ALIAS_SYMBOL_MAP.get(sym)?.name ?? sym,
          category: ALIAS_SYMBOL_MAP.get(sym)?.category ?? "metal",
          price,
          prevClose: base,
          changePct: base > 0 ? ((price - base) / base) * 100 : 0,
          basis: typeof meta?.previousClose === "number" && meta.previousClose > 0 ? "prevClose" : "windowClose",
          ts: meta?.regularMarketTime ?? Math.floor(now / 1000),
        };
        quoteCache.set(sym, { data: q, at: now });
        results.push(q);
      } catch {
        // 单标的失败静默跳过（调用方注入块只列拿到的，AI对缺失品种按边界声明处理）
      }
    }),
  );

  // 注入顺序稳定：按传入symbols序（predictable for prompt caching前缀）
  return symbols
    .map((s) => results.find((r) => r.symbol === s))
    .filter((x): x is CommodityQuote => Boolean(x));
}

const ALIAS_SYMBOL_MAP = new Map(
  Object.values(COMMODITY_ALIASES).map((d) => [d.symbol, d]),
);

const CATEGORY_LABEL: Record<CommodityQuote["category"], string> = {
  metal: "贵金属/工业金属",
  energy: "能源",
  crypto: "加密资产",
  fx: "汇率指数",
};

export function buildCommodityContext(quotes: CommodityQuote[]): string {
  if (quotes.length === 0) return "";
  const fmt = (n: number) =>
    n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(Number(n.toFixed(n < 10 ? 4 : 2)));
  const lines = quotes.map((q) => {
    const arrow = q.changePct >= 0 ? "涨" : "跌";
    // 口径诚实：windowClose=previousClose缺失降级为5日窗口基准，标注防"5日涨幅被当昨日涨幅"漂移（10/17验证轮补缺）
    const baseLabel = q.basis === "windowClose" ? "近5日前值" : "昨收";
    return `- ${q.name}（${q.symbol}）：$${fmt(q.price)}，${baseLabel}$${fmt(q.prevClose)}（${arrow}${Math.abs(q.changePct).toFixed(2)}%）`;
  });
  const covered = Array.from(new Set(quotes.map((q) => CATEGORY_LABEL[q.category]))).join("、");
  // 行情时间标注：周末/盘后拉到的是上一交易时段价（如周六GC=F=周五结算价）——防AI把旧价说成"现在价"（10/17验证轮补缺）
  const ts = new Date(Math.max(...quotes.map((q) => q.ts)) * 1000);
  const nyTime = ts.toLocaleString("zh-CN", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    `【${covered}实时行情】（Yahoo Finance口径：期货=主力连续合约最新价，加密=现货聚合价，美元计价；行情时间≈纽约时间${nyTime}——周末/盘后为上一交易时段价格，加密为24/7实时）\n` +
    lines.join("\n") +
    `\n⚠️ 引用规则：以上是数据源最新可得价（加密24/7实时，期货含电子盘时段），非"A股/B股收盘价"；未列出的品种（其他小币种、农产品、国内期货品种如沪金/螺纹钢）行情源未覆盖，严禁编造价格，可定性分析。`
  );
}
