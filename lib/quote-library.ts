/**
 * 大师语录检索层（9/13阶段2第四批——语录渐进补采；9/25 V3升级：14大师126条）
 * 形态：按问题主题+大师名检索2-4条注入，每条带来源锚+置信级标注
 * 纪律：置信三级=T2确认原文/T3通行中译/T3转述（大意）；引用闸门（buildQuoteGuardBlock）防假语录与本块并行
 * 数据源：data/quotes_buffett_t1.json（原9条巴菲特）+ data/quotes_masters_v3.json（nuwa-v3蒸馏14大师126条）
 */
import qb from "../data/quotes_buffett_t1.json";
import mv3 from "../data/quotes_masters_v3.json";

interface Quote { year?: number; theme: string; quote: string; anchor: string; usage_hint?: string; confidence?: string }
interface QuoteV3 { master: string; theme: string; quote: string; anchor: string; confidence: string }

const QUOTES = (qb as { quotes: Quote[] }).quotes;
const V3 = (mv3 as { quotes: QuoteV3[] }).quotes;

const THEME_TRIGGERS: { theme: string; kws: RegExp }[] = [
  { theme: "估值", kws: /估值|便宜|贵|低估|高估|价格合理|安全边际|值搏/ },
  { theme: "护城河", kws: /护城河|竞争优势|壁垒|行业选择|差异化/ },
  { theme: "分散", kws: /分散|集中|组合|重仓一只/ },
  { theme: "长期持有", kws: /长期持有|拿多久|持有期限|拿十年|永不卖出/ },
  { theme: "能力圈", kws: /能力圈|看得懂|不懂|认知边界/ },
  { theme: "风险", kws: /风险|杠杆|裸泳|退潮|尾部|黑天鹅|止损|破产|存活/ },
  { theme: "情绪", kws: /情绪|恐惧|贪婪|恐慌|误判|心理|平常心|心动/ },
  { theme: "周期", kws: /周期|钟摆|萧条|复苏|债务|宏观|流动性/ },
  { theme: "决策", kws: /判断|决策|原则|规则|纪律|行动|知行/ },
  { theme: "执行", kws: /执行|仓位|加仓|减仓|等待|耐心|关键点/ },
  { theme: "成长", kws: /成长|研发|销售|创新|技术|闲聊/ },
];

// 大师名触发（用户显式问某大师时优先注入该大师语录）
const MASTER_TRIGGERS: [string, RegExp][] = [
  ["段永平", /段永平|大道|本分/], ["利弗莫尔", /利弗莫尔|大作手|投机之王/],
  ["西蒙斯", /西蒙斯|文艺复兴|量化/], ["王阳明", /王阳明|阳明|心学/],
  ["巴菲特", /巴菲特|伯克希尔/], ["芒格", /芒格|穷查理/],
  ["索罗斯", /索罗斯|反身性|金融炼金术/], ["马斯克", /马斯克|第一性原理/],
  ["格雷厄姆", /格雷厄姆|市场先生|聪明的投资者/], ["马克斯", /马克斯|霍华德|周期.*投资|第二层思维/],
  ["费雪", /费雪|成长股|闲聊法/], ["塔勒布", /塔勒布|黑天鹅|反脆弱|杠铃/],
  ["达里奥", /达里奥|桥水|债务危机/], ["卡拉曼", /卡拉曼|安全边际书/],
];

/** 按问题主题+大师名检索语录（最多4条）——无命中返回空（不硬凑） */
export function buildQuoteLibraryBlock(queryText: string): string {
  const q = queryText || "";
  const themes = THEME_TRIGGERS.filter(t => t.kws.test(q)).map(t => t.theme);
  const hitMasters = MASTER_TRIGGERS.filter(([, re]) => re.test(q)).map(([m]) => m);

  // 原库（巴菲特股东信）
  const legacyHits = themes.length ? QUOTES.filter(x => themes.includes(x.theme)).slice(0, 2) : [];

  // V3库：显式问某大师→该大师语录优先；否则按主题
  let v3Hits: QuoteV3[] = [];
  if (hitMasters.length) {
    v3Hits = V3.filter(x => hitMasters.includes(x.master) && (!themes.length || themes.includes(x.theme))).slice(0, 3);
    if (v3Hits.length < 2) v3Hits = v3Hits.concat(V3.filter(x => hitMasters.includes(x.master) && !v3Hits.includes(x)).slice(0, 3 - v3Hits.length));
  } else if (themes.length) {
    v3Hits = V3.filter(x => themes.includes(x.theme)).slice(0, 2);
  }
  if (!legacyHits.length && !v3Hits.length) return "";

  const out: string[] = ["", "【大师语录检索】（置信级标注：T2确认原文/T3通行中译/T3转述大意——引用时按级标注，T3不冒充原文；对照其公开认错记录防神化）"];
  for (const x of legacyHits) {
    out.push(`- 巴菲特（${x.year}）「${x.quote}」——${x.usage_hint}。[T3通行中译]`);
  }
  for (const x of v3Hits) {
    out.push(`- ${x.master}「${x.quote}」——${x.anchor}。[${x.confidence}]`);
  }
  out.push("");
  return out.join("\n");
}
