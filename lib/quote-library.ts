/**
 * 大师语录检索层（9/13阶段2第四批——语录渐进补采）
 * 形态：按问题主题（估值/护城河/分散/持有/能力圈/风险）检索2-3条注入，每条带年份锚+置信级标注
 * 纪律：T3通行中译诚实标级（未对照英文原文前不冒充T1）；引用闸门（buildQuoteGuardBlock）防假语录与本块并行
 */
import qb from "../data/quotes_buffett_t1.json";

interface Quote { year: number; theme: string; quote: string; anchor: string; usage_hint: string }
const QUOTES = (qb as { quotes: Quote[] }).quotes;

const THEME_TRIGGERS: { theme: string; kws: RegExp }[] = [
  { theme: "估值", kws: /估值|便宜|贵|低估|高估|价格合理|安全边际/ },
  { theme: "护城河", kws: /护城河|竞争优势|壁垒|行业选择/ },
  { theme: "分散", kws: /分散|集中|组合|重仓一只/ },
  { theme: "长期持有", kws: /长期持有|拿多久|持有期限|拿十年/ },
  { theme: "能力圈", kws: /能力圈|看得懂|不懂|认知边界/ },
  { theme: "风险", kws: /风险|杠杆|裸泳|退潮|尾部/ },
];

/** 按问题主题检索语录（最多3条）——无命中返回空（不硬凑） */
export function buildQuoteLibraryBlock(queryText: string): string {
  const q = queryText || "";
  const themes = THEME_TRIGGERS.filter(t => t.kws.test(q)).map(t => t.theme);
  if (!themes.length) return "";
  const hits = QUOTES.filter(x => themes.includes(x.theme)).slice(0, 3);
  if (!hits.length) return "";
  return [
    "",
    "【巴菲特股东信语录】（T3通行中译——引用格式「巴菲特（19XX年股东信）」，讨论中可对照原文语境）",
    ...hits.map(x => `- （${x.year}）「${x.quote}」——${x.usage_hint}。`),
    "",
  ].join("\n");
}
