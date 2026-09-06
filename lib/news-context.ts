// chat实时讯息注入（9/6新增）
// 用户提问时拉取最新快讯，按相关性匹配注入system prompt，让AI知道"现在市场上在发生什么"
import { getFlashFeed, type FlashItem } from "@/lib/flash-source";
import { extractStockCodes } from "@/lib/stock-context";

// 常见美股代码↔公司中文名/关键词映射（匹配快讯用，覆盖高频标的）
const TICKER_ALIASES: Record<string, string[]> = {
  NVDA: ["英伟达"],
  AAPL: ["苹果"],
  MSFT: ["微软"],
  AMZN: ["亚马逊"],
  GOOGL: ["谷歌", "Alphabet"],
  GOOG: ["谷歌", "Alphabet"],
  META: ["Meta", "脸书", "扎克伯格"],
  TSLA: ["特斯拉", "马斯克"],
  AVGO: ["博通"],
  AMD: [" AMD", "超微"],
  INTC: ["英特尔"],
  QCOM: ["高通"],
  MU: ["美光"],
  ARM: [" ARM"],
  NFLX: ["奈飞", " Netflix"],
  JPM: ["摩根大通", " JPMorgan"],
  GS: ["高盛", " Goldman"],
  MS: ["摩根士丹利", " Morgan Stanley"],
  XOM: ["埃克森", " Exxon"],
  CVX: ["雪佛龙", " Chevron"],
  BABA: ["阿里巴巴", "阿里"],
  PDD: ["拼多多"],
  JD: ["京东"],
  BIDU: ["百度"],
  NIO: ["蔚来"],
  LI: ["理想汽车", "理想"],
  XPEV: ["小鹏"],
  KO: ["可口可乐", " Coca-Cola"],
  PEP: ["百事", " Pepsi"],
  MCD: ["麦当劳", " McDonald"],
  NKE: ["耐克", " Nike"],
  DIS: ["迪士尼", " Disney"],
  BA: ["波音", " Boeing"],
  LMT: ["洛克希德", " Lockheed"],
  JNJ: ["强生", " Johnson"],
  PFE: ["辉瑞", " Pfizer"],
  V: [" Visa", "维萨"],
  COST: ["好市多", " Costco"],
  WMT: ["沃尔玛", " Walmart"],
  ORCL: ["甲骨文", " Oracle"],
  CRM: [" Salesforce", "赛富时"],
  IBM: [" IBM"],
  TSM: ["台积电", " TSMC"],
  QQQ: ["纳指", "纳斯达克100", " QQQ"],
  SPY: ["标普", " S&P", " SPY"],
  DIA: ["道指", " Dow"],
  IWM: ["罗素", " Russell"],
};

// 宏观/主题关键词（用户没提具体标的时，这些词直接匹配快讯）
const MACRO_KEYWORDS = [
  "美联储", "降息", "加息", "利率", "通胀", "CPI", "PCE", "非农", "就业",
  "GDP", "经济衰退", "关税", "贸易", "原油", "油价", "黄金", "白银",
  "芯片", "半导体", "AI", "财报", "政府停摆", "国债", "美元", "日元",
  "鲍威尔", "特朗普", "拜登", "哈里斯", "马斯克", "地缘", "战争",
];

const MAX_ITEMS = 5;
const MAX_AGE_SECONDS = 6 * 3600; // 超6小时的旧闻不注入
const MAX_ITEM_CHARS = 180; // 单条截断（快讯多数≤150字）

function itemAge(item: FlashItem): number {
  return Math.floor(Date.now() / 1000) - item.timestamp;
}

function formatClockTime(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** 收集用户文本里可用于匹配快讯的关键词（代码/公司名/宏观词） */
export function collectKeywords(userText: string): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();

  const push = (word: string) => {
    const w = word.trim();
    if (w && !seen.has(w)) {
      seen.add(w);
      keywords.push(w);
    }
  };

  // 股票代码 + 其别名
  for (const code of extractStockCodes(userText)) {
    push(code);
    for (const alias of TICKER_ALIASES[code] ?? []) push(alias);
  }

  // 代码别名直接命中（用户写了中文公司名而没写代码）
  for (const [code, aliases] of Object.entries(TICKER_ALIASES)) {
    for (const alias of aliases) {
      const bare = alias.trim();
      if (bare.length >= 2 && userText.includes(bare)) {
        push(code);
        push(bare);
      }
    }
  }

  // 宏观关键词
  for (const word of MACRO_KEYWORDS) {
    if (userText.includes(word)) push(word);
  }

  return keywords;
}

/** 关键词命中分（纯相关性，不含新鲜度/重要度——是否入选只看这个） */
function keywordScore(item: FlashItem, keywords: string[]): number {
  const haystack = item.content_text.toLocaleLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    const kw = keyword.trim().toLocaleLowerCase();
    if (kw && haystack.includes(kw)) {
      // 代码精确匹配权重高（如"NVDA"），中文公司名/宏观词权重中
      score += /^[a-z]{1,6}$/.test(kw) ? 3 : 2;
    }
  }
  return score;
}

/** 排序加成：重要+新鲜（只在关键词命中集内部做排序微调，绝不参与是否入选） */
function rankBoost(item: FlashItem): number {
  let boost = 0;
  if (item.is_important) boost += 1;
  // 越新分越高（6小时窗口内线性衰减+1~3分）
  const age = itemAge(item);
  if (age >= 0 && age <= MAX_AGE_SECONDS) {
    boost += 3 * (1 - age / MAX_AGE_SECONDS);
  }
  return boost;
}

/**
 * 构建实时讯息注入块。
 * - 命中关键词：注入相关快讯（按相关性排序，最多5条）
 * - 未命中：注入最近的重要快讯头条（让AI至少知道当前市场基调）
 * - 全部失败/过期：返回空字符串（快讯是增强不是依赖，静默降级）
 */
export async function buildNewsContext(userText: string): Promise<string> {
  try {
    const { items } = await getFlashFeed();
    if (items.length === 0) return "";

    const fresh = items.filter((i) => itemAge(i) <= MAX_AGE_SECONDS);
    if (fresh.length === 0) return "";

    const keywords = collectKeywords(userText);
    // 入选只看关键词命中分（rankBoost只影响命中集内部排序，防止新鲜度加成把零命中条目顶进"相关"）
    const matched = keywords.length > 0
      ? fresh
          .map((item) => ({ item, kw: keywordScore(item, keywords), boost: rankBoost(item) }))
          .filter((r) => r.kw > 0)
          .sort((a, b) => b.kw * 10 + b.boost - (a.kw * 10 + a.boost))
          .slice(0, MAX_ITEMS)
          .map((r) => r.item)
      : [];

    // 未命中→取最近的（重要优先）
    const selected = matched.length > 0
      ? matched
      : [...fresh]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, MAX_ITEMS);

    if (selected.length === 0) return "";

    const nowClock = formatClockTime(Math.floor(Date.now() / 1000));
    const lines = selected.map((item) => {
      const clock = formatClockTime(item.timestamp);
      return `- [${clock}（${item.time_str}）] ${item.source}: ${truncate(item.content_text.replace(/\s+/g, " "), MAX_ITEM_CHARS)}`;
    });

    const matchedNote = matched.length > 0
      ? `以下为与问题相关的最新市场快讯（按相关性排序）：`
      : `用户未提及具体标的/主题，以下为最近的市场头条快讯：`;

    return [
      "",
      "【实时市场快讯】（系统自动注入，供回答时参考）",
      matchedNote,
      `当前时间 ${nowClock}。快讯时间以[时:分]为准，括号内相对时间为注入时刻的口径，引用时标注快讯时间。与你的知识冲突时，快讯更新。`,
      ...lines,
      "",
    ].join("\n");
  } catch {
    return "";
  }
}
