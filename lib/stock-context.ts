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

const STOP_WORDS = new Set(["PE","PB","ROE","ROA","EPS","CEO","CFO","CTO","IPO","ETF","GDP","CPI","FED","API","JSON","HTTP","URL","USD","USA","AI","ML","PR","IR","IT","AR","VR","PC","GB","TB","CPU","GPU","RAM","SSD","HDD","USB","HDMI","WTO","WHO","NYC","LAX","SFO","DC","LA","SF","FOMC","PMI","LPR","SEC","IMF","OPEC","REIT","SPAC","NFT","ADR","ICO","DAO","APP","VS","OK","PS","ID","VIX","DXY","BUY","SELL","HOLD","LONG","SHORT","STOP","LOSS","RISK","GAIN","CALL","PUT","ETFs","AMA","FAQ","TL;DR"]);

// 加密资产符号：不作为股票代码拉行情（Yahoo/腾讯会把BTC解析成Grayscale ETF等同名美股产品，
// 价格与加密现货量级完全不同，注入后模型会拿ETF价格冒充币价——比编造更隐蔽的误导）
const CRYPTO_SYMBOLS = new Set([
  "BTC","ETH","SOL","DOGE","XRP","ADA","BNB","AVAX","DOT","MATIC","LTC","SHIB",
  "TRX","LINK","ATOM","ETC","FIL","NEAR","APT","ARB","SUI","PEPE","USDT","USDC",
]);

const CRYPTO_ALIASES: Record<string, string> = {
  "比特币": "BTC", "大饼": "BTC", "以太坊": "ETH", "以太币": "ETH", "狗狗币": "DOGE",
  "瑞波币": "XRP", "莱特币": "LTC", "索拉纳": "SOL", "泰达币": "USDT",
};

// 提取加密资产符号（用于注入数据边界声明），中英文都认
export function extractCryptoSymbols(text: string): string[] {
  const found = new Set<string>();
  const upper = text.toUpperCase();
  const symMatches = upper.match(/(?<![A-Z0-9])([A-Z]{2,5})(?![A-Z0-9])/g);
  if (symMatches) symMatches.forEach((c) => { if (CRYPTO_SYMBOLS.has(c)) found.add(c); });
  for (const [alias, sym] of Object.entries(CRYPTO_ALIASES)) {
    if (text.includes(alias)) found.add(sym);
  }
  return Array.from(found).slice(0, 4);
}

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

  return Array.from(codes).filter((c) => !CRYPTO_SYMBOLS.has(c)).slice(0, 4);
}

// 历史锚点缓存：Yahoo chart对云IP限流敏感（429），15分钟缓存把重复请求压到最低
import { getYahooChart, extractHistoryAnchors, type HistoryAnchors } from "./yahoo-chart";
import { fetchSAYahooLikeChart } from "./stockanalysis";

const histCache = new Map<string, { data: HistoryAnchors | null; expiresAt: number }>();

// 行情短期缓存：同会话连续追问同一只股票，90秒内直接回缓存——TTFB从3-8s降到<10ms
// TTL=90s的实时性代价：盘中价格最多滞后90秒，对对话分析场景可忽略（分析结论不因毫秒级差价改变）
const quoteCache = new Map<string, { data: Awaited<ReturnType<typeof fetchStockData>>[number] | null; expiresAt: number }>();
const QUOTE_CACHE_TTL = 90_000;

export async function fetchStockData(codes: string[]): Promise<Array<{
  code: string; name: string; price: number | null; pe: number | null;
  changePct: number | null; marketCap: number | null;
  previousClose: number | null; open: number | null; high: number | null; low: number | null; volume: number | null;
  freshness: string | null; divergence: number | null; anomaly: boolean; extremeMove: boolean;
  history: HistoryAnchors | null;
}>> {
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

  const now = Date.now();
  // 缓存整理：顺手清过期项防泄漏（forEach而非for..of——es5 target下Map迭代需downlevelIteration，forEach无此限制且边删边遍历安全）
  quoteCache.forEach((v, k) => {
    if (v.expiresAt < now) quoteCache.delete(k);
  });

  return Promise.all(codes.map(async (code) => {
    const cached = quoteCache.get(code);
    if (cached && cached.expiresAt > now) return cached.data as Awaited<ReturnType<typeof fetchStockData>>[number];
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
    // D2原始快照：真实大涨大跌（如财报跳空>20%）时腾讯会被闸门弃用，留快照供双源确认后恢复
    let qtRawPrice = 0, qtRawPrev = 0, qtRawPct = 0, qtRawPE = 0, f44Cap = 0, qtRealMover = false;
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
            qtRawPrice = pPrice; qtRawPrev = pPrev; qtRawPct = pPct; qtRawPE = pPE;
            f44Cap = f[44] !== "" && !isNaN(parseFloat(f[44])) && parseFloat(f[44]) > 0 ? parseFloat(f[44]) * 1e8 : 0;
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
              // D1新鲜度：f[30]=美东完整时间"YYYY-MM-DD HH:MM:SS"（腾讯偶尔用斜杠分隔，防御兼容）
              const tm = (f[30] || "").match(/(\d{4})[-/](\d{2})[-/](\d{2}) (\d{2}):(\d{2}):(\d{2})/);
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
    // 历史锚点：Yahoo chart 1y日线（免crumb，浏览器headers）。注入后AI可回答"年内涨跌/52周位置/放量缩量/距高点回撤"类问题
    // 1y而非3mo：YTD起点+6月前+52周锚点必须1y数据（3mo下meta的52周高低仍在但其余全缺）
    // 2026-08-23：Yahoo对Vercel出口IP全面429，失败时用stockanalysis.com日线兜底（90天，锚点降级：6月/YTD/52周为null，模型按D2数据未注入处理）
    let history: HistoryAnchors | null = null;
    const cachedHist = histCache.get(code);
    if (cachedHist && cachedHist.expiresAt > Date.now()) {
      history = cachedHist.data;
    } else try {
      const yahooChart = await getYahooChart(code, "1y");
      const chart = yahooChart ?? (await fetchSAYahooLikeChart(code, 90) as Awaited<ReturnType<typeof getYahooChart>>);
      history = extractHistoryAnchors(chart);
      histCache.set(code, { data: history, expiresAt: Date.now() + 15 * 60 * 1000 });
    } catch {}

    // D2豁免：腾讯被闸门弃用但Finnhub价格与腾讯原始价一致(±1.5%)→真实极端行情(财报跳空/熔断级波动)，恢复数据
    if (!qtValid && qtRawPrice > 0 && fhPrice != null && fhPrice > 0) {
      if (Math.abs(qtRawPrice - fhPrice) / fhPrice <= 0.015) {
        qtRealMover = true;
        price = qtRawPrice;
        previousClose = qtRawPrev || null;
        changePct = qtRawPct;
        pe = qtRawPE > 0 ? qtRawPE : null;
        if (marketCap == null && f44Cap > 0) marketCap = f44Cap;
      }
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
        const yahooCode = code.replace(".", "-");
        const yahooRes = await fetch(
          `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooCode)}?interval=1d&range=1d`,
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

    const result = { code, name, price, pe, changePct, marketCap, previousClose, open, high, low, volume, freshness: qtTimestamp, divergence, anomaly: !qtValid && !qtRealMover && price != null, extremeMove: qtRealMover, history };
    // 成功获取才缓存（价格有值）；失败结果不缓存，下轮重试上游
    if (result.price != null) quoteCache.set(code, { data: result, expiresAt: Date.now() + QUOTE_CACHE_TTL });
    return result;
  }));
}

export function buildStockContext(
  stockData: Array<{ code: string; name: string; price: number | null; pe: number | null; changePct: number | null; marketCap: number | null; previousClose: number | null; open: number | null; high: number | null; low: number | null; volume: number | null; freshness: string | null; divergence: number | null; anomaly: boolean; extremeMove: boolean; history: HistoryAnchors | null }>,
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
    if (s.extremeMove) parts.push(`[单日涨跌超20%，腾讯+Finnhub双源一致确认，真实行情非数据错误，按正常数据结合波动风险分析]`);
    if (s.price != null) parts.push(`现价:$${s.price}`);
    if (s.previousClose != null) parts.push(`昨收:$${s.previousClose}`);
    if (s.changePct != null) parts.push(`涨跌:${s.changePct}%`);
    if (s.open != null) parts.push(`开:$${s.open}`);
    if (s.high != null) parts.push(`高:$${s.high}`);
    if (s.low != null) parts.push(`低:$${s.low}`);
    if (s.volume != null) {
      // 9/6质量修复：原`/1e6标"亿股"`单位错位100倍（5363万股→"53.63亿股"）——≥1亿显示亿股，否则万股
      const volYi = s.volume / 1e8;
      parts.push(volYi >= 1 ? `量:${volYi.toFixed(2)}亿股` : `量:${Math.round(s.volume / 1e4)}万股`);
    }
    if (s.pe != null) parts.push(`PE:${s.pe}`);
    if (s.marketCap != null) {
      const capB = s.marketCap / 1e9;
      if (capB > 1) parts.push(`市值:$${capB.toFixed(0)}B`);
    }
    if (s.divergence != null) parts.push(`[两源分歧±${s.divergence.toFixed(2)}%，腾讯vs Finnhub，须呈现两值]`);
    if (s.history && (s.history.oneMonthAgo != null || s.history.monthHigh != null)) {
      const h = s.history;
      const parts2: string[] = [];
      if (h.oneMonthAgo != null) parts2.push(`1月前:${h.oneMonthAgo.toFixed(2)}`);
      if (h.threeMonthsAgo != null) parts2.push(`3月前:${h.threeMonthsAgo.toFixed(2)}`);
      if (h.sixMonthsAgo != null) parts2.push(`6月前:${h.sixMonthsAgo.toFixed(2)}`);
      if (h.ytdStart != null) parts2.push(`年初:${h.ytdStart.toFixed(2)}`);
      if (h.monthHigh != null) parts2.push(`近1月高:${h.monthHigh.toFixed(2)}`);
      if (h.monthLow != null) parts2.push(`近1月低:${h.monthLow.toFixed(2)}`);
      if (h.fiftyTwoWeekHigh != null) parts2.push(`52周高:${h.fiftyTwoWeekHigh.toFixed(2)}`);
      if (h.fiftyTwoWeekLow != null) parts2.push(`52周低:${h.fiftyTwoWeekLow.toFixed(2)}`);
      if (parts2.length > 0) parts.push(`历史锚点[${parts2.join(" | ")}](Yahoo日线)`);
      // MA均线锚：现价vs均线位置=多头/空头排列的直接判断依据（计算含最新K线，盘中=即时均线）
      const mas: string[] = [];
      if (h.ma20 != null) mas.push(`MA20:${h.ma20.toFixed(2)}`);
      if (h.ma50 != null) mas.push(`MA50:${h.ma50.toFixed(2)}`);
      if (h.ma200 != null) mas.push(`MA200:${h.ma200.toFixed(2)}`);
      if (mas.length > 0) parts.push(`均线[${mas.join(" | ")}](Yahoo日线，含最新价)`);
    }
    // 量能基线：当日量与近20日均量的比值——放量/缩量判断的唯一依据（无基线时AI只能猜）
    // 盘中口径护栏：今日量为盘中累计量（未收盘），上午时段除以全天均量必然偏低=误报缩量。
    // 美股盘中（美东工作日9:30-16:00）时标注盘中语义，收盘数据才直接给倍数
    if (s.history?.avgVolume20 != null && s.volume != null && s.history.avgVolume20 > 0) {
      const volRatio = s.volume / s.history.avgVolume20;
      const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = et.getDay();
      const minutes = et.getHours() * 60 + et.getMinutes();
      const inSession = day >= 1 && day <= 5 && minutes >= 570 && minutes < 960; // 9:30-16:00
      parts.push(
        inSession
          ? `量能:今日盘中量为20日均量的${volRatio.toFixed(1)}倍(未收盘，日内扩量中，禁止据此判断缩量)`
          : `量能:今日量为20日均量的${volRatio.toFixed(1)}倍`,
      );
    }
    return `- ${parts.join(" | ")}`;
  });
  return [
    "",
    `用户提到的股票实时数据（腾讯行情主源+Finnhub交叉，${new Date().toLocaleString("zh-CN", { timeZone: "America/New_York", hour12: false })} 美东时间）：`,
    ...lines,
    "涨跌幅计算基准为昨收。历史锚点计算照S1展示算式（如距52周高点回撤=(现价-52周高)/52周高×100，年内涨跌=(现价-年初)/年初×100）。执行S1展示算式、D1保留新鲜度标注、D2异常标注不可抹除、D3有分歧标注时必须呈现两源数字。锚点未注入的字段写「数据缺失」，禁止编造（S2/D2）。",
  ].join("\n");
}


// ── 市场情绪供给（9/6深水区：VIX真实锚——原先多空论据里情绪维度靠猜） ──

export type MarketMood = { vix: number; vixPrevClose: number; vixHigh5d: number; vixLow5d: number } | null;

export async function fetchVix(): Promise<MarketMood> {
  try {
    const chart = await getYahooChart("^VIX", "5d");
    if (!chart) return null;
    const price = chart.meta?.regularMarketPrice;
    const prev = chart.meta?.chartPreviousClose;
    if (typeof price !== "number" || !Number.isFinite(price)) return null;
    const closes: number[] = (chart.indicators?.quote?.[0]?.close ?? []).filter(
      (c: unknown): c is number => typeof c === "number" && Number.isFinite(c),
    );
    const high5d = closes.length > 0 ? Math.max(...closes) : price;
    const low5d = closes.length > 0 ? Math.min(...closes) : price;
    return {
      vix: Math.round(price * 100) / 100,
      vixPrevClose: typeof prev === "number" ? Math.round(prev * 100) / 100 : price,
      vixHigh5d: Math.round(high5d * 100) / 100,
      vixLow5d: Math.round(low5d * 100) / 100,
    };
  } catch {
    return null;
  }
}

export function buildMarketMoodBlock(mood: MarketMood): string {
  if (!mood) return "";
  const { vix, vixPrevClose, vixHigh5d, vixLow5d } = mood;
  const vixChange = vixPrevClose > 0 ? Math.round(((vix - vixPrevClose) / vixPrevClose) * 1000) / 10 : 0;
  let regime: string;
  if (vix < 14) regime = "贪婪区（<14）";
  else if (vix < 20) regime = "中性区（14-20）";
  else if (vix < 28) regime = "焦虑区（20-28）";
  else regime = "恐慌区（>=28）";
  const position = vixHigh5d > vixLow5d
    ? `5日区间第${Math.round(((vix - vixLow5d) / (vixHigh5d - vixLow5d)) * 10)}/10位`
    : "5日持平";
  return [
    "【市场情绪指标（VIX恐慌指数，实时注入）】",
    `VIX当前:${vix} | 昨日:${vixPrevClose}(${vixChange >= 0 ? "+" : ""}${vixChange}%) | 5日区间:${vixLow5d}-${vixHigh5d}（当前处${position}）`,
    `情绪分档：${regime}。此为真实数据非推测——分析市场情绪维度时必须引用本数据，禁止凭感觉猜测情绪状态。`,
  ].join("\n");
}
