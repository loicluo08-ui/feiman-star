/**
 * 案例库（公开经典判断案例）——9/12长线计划阶段一·备选路径，9/13 B队21案扩容
 * 来源：B队任务12收尾交付（零编造红线/置信级逐案可查），data/case_library_v2.json
 * 形态：few-shot检索层（E队方案）——按问题标的/大师/情境检索3-6案注入，非全量（21案全量≈5K tokens）。
 * 边界：全部标注"外部经典案例，非罗竹先框架原生"（规则0g框架边界纪律）。
 * 罗竹先案例到位后逐条替换/追加（格式对齐本文件）。
 */
import caseData from "../data/case_library_v2.json";
import nuwaData from "../data/case_library_v3_nuwa.json";

interface CaseRow { id: string; master: string; target: string; year: string; type: string; confidence: string; lesson: string; source_task: string }

const CASES = [
  ...(caseData as { cases: CaseRow[]; recurrence_triplets: { pattern: string; case: string; chain: string; note: string }[] }).cases,
  ...(nuwaData as { cases: CaseRow[] }).cases, // 9/25 nuwa-v3蒸馏案例库（14大师31案，T2公开资料整理）
];
const RECURRENCE = (caseData as { recurrence_triplets: { pattern: string; case: string; chain: string; note: string }[] }).recurrence_triplets;

// 保留的原3案（v1手工版——利弗莫尔1907为v2所无）
const LEGACY_CASES = [
  "案例｜利弗莫尔1907年旧金山地震后做空：背景=地震后市场因重建资金预期先反弹；反方论据=灾难后爱国性买入情绪+流动性注入；判断依据=资金真实流向（铁路运力被救灾占用、银行紧缩）与市场情绪背离，「市场永远对，但情绪会先撒谎」；结果=空头大胜。可迁移模式：关键点不是价格位置本身，是价格与资金/情绪共识的背离度。",
];

// 标的/大师/情境 匹配词表
const TARGET_KEYWORDS: [string, string[]][] = [
  ["可口可乐", ["可乐", "coca", "ko "]], ["苹果", ["苹果", "aapl", "iphone"]], ["德克斯特", ["德克斯特", "鞋业"]],
  ["IBM", ["ibm"]], ["康菲石油", ["康菲", "conoco", "cop ", "石油"]], ["航空", ["航空", "达美", "美联航", "四大航"]],
  ["中石油", ["中石油", "petrochina"]], ["沃尔玛", ["沃尔玛", "walmart", "wmt"]], ["台积电", ["台积电", "tsm"]],
  ["网易", ["网易", "ntes"]], ["茅台", ["茅台", "moutai"]], ["腾讯", ["腾讯", "tencent"]],
  ["拼多多", ["拼多多", "pdd"]], ["比亚迪", ["比亚迪", "byd"]], ["阿里", ["阿里", "alibaba", "阿里巴巴"]],
  ["英镑", ["英镑", "英国", "erm", "英格兰银行"]], ["德州仪器", ["德州仪器", "德仪", "ti "]], ["通用动力", ["通用动力"]],
  ["硅谷", ["硅谷", "quantum", "量子基金"]], ["信贷", ["信贷", "高收益债", "垃圾债"]], ["covid", ["疫情", "新冠", "covid", "崩盘"]],
];

const MASTER_KEYWORDS: [string, string[]][] = [
  ["巴菲特", ["巴菲特", "buffett", "伯克希尔"]], ["芒格", ["芒格", "munger"]], ["段永平", ["段永平", "duan"]],
  ["马克斯", ["马克斯", "howard marks", "橡树"]], ["索罗斯", ["索罗斯", "soros"]], ["德鲁肯米勒", ["德鲁肯米勒", "druckenmiller"]],
  ["费雪", ["费雪", "fisher"]], ["利弗莫尔", ["利弗莫尔", "livermore"]],
  // 9/25 nuwa-v3扩展
  ["西蒙斯", ["西蒙斯", "文艺复兴", "simons"]], ["王阳明", ["王阳明", "阳明", "心学"]],
  ["马斯克", ["马斯克", "musk", "第一性"]], ["格雷厄姆", ["格雷厄姆", "graham", "市场先生"]],
  ["塔勒布", ["塔勒布", "taleb", "黑天鹅", "反脆弱"]], ["达里奥", ["达里奥", "桥水", "dalio", "原则"]],
  ["卡拉曼", ["卡拉曼", "klarman", "安全边际"]],
];

const CONTEXT_KEYWORDS: [string, string[]][] = [
  ["失败/认错", ["认错", "失败", "错在", "误判", "犯错", "教训"]],
  ["卖出/止损", ["卖出", "清仓", "止损", "离场", "减仓", "卖飞"]],
  ["危机部署", ["危机", "恐慌", "崩盘", "暴跌", "底部", "别人恐惧"]],
  ["追高/泡沫", ["追高", "泡沫", "狂热", "顶部", "踏空"]],
  ["建仓/重仓", ["建仓", "重仓", "下注", "买入", "加仓"]],
];

function scoreCase(c: CaseRow, q: string): number {
  let s = 0;
  const ql = q.toLowerCase();
  // 标的匹配：查询命中某标的关键词 且 案例标的字段含该标的名
  for (const [name, kws] of TARGET_KEYWORDS) {
    if (kws.some(k => ql.includes(k)) && c.target.includes(name)) s += 3;
  }
  for (const [id, kws] of MASTER_KEYWORDS) if (kws.some(k => ql.includes(k)) && c.master.includes(id)) s += 2;
  // 情境词与案例类型匹配
  const type = c.type;
  if (/失败|认错/.test(q) && /失败|自省/.test(type)) s += 2;
  if (/卖出|清仓|止损|离场/.test(q) && type.includes("卖出")) s += 3;
  if (/危机|恐慌|崩盘|暴跌/.test(q) && /危机/.test(type)) s += 3;
  if (/追高|泡沫|狂热/.test(q) && /追高/.test(type)) s += 3;
  if (/建仓|重仓|买入|加仓/.test(q) && /建仓|重仓|部署/.test(type)) s += 2;
  return s;
}

function fmtCase(c: CaseRow): string {
  return `【${c.id}】${c.master.replace(/（.*$/, "")}·${c.target}（${c.year}，${c.type}，置信${c.confidence}）：${c.lesson}`;
}

/** 按问题检索案例（few-shot检索层）——无命中给三范式默认组（建仓/失败/卖出各一） */
export function buildCaseLibraryBlock(queryText: string): string {
  const q = (queryText || "").toLowerCase();
  const scored = CASES.map(c => ({ c, s: scoreCase(c, q) })).sort((a, b) => b.s - a.s);
  const hit = scored.filter(x => x.s > 0).slice(0, 5);
  const picked = hit.length >= 3 ? hit : [
    ...hit,
    ...scored.filter(x => x.s === 0 && ["B-001", "B-003", "S-001"].includes(x.c.id)).slice(0, 3 - hit.length),
  ];
  // 同构重犯：问题涉认错/失败/重犯情境时带出
  const recLine = /认错|失败|重犯|又错|再犯/.test(q)
    ? `\n【同构重犯三件套】同一错误模式跨越30年反复——大师也会重犯：${RECURRENCE.map(r => `${r.case}（${r.pattern}：${r.chain}）`).join("；")}`
    : "";
  const lines = [
    "",
    "【经典判断案例库】（外部经典案例，非罗竹先框架原生——引用时标注「外部案例」与置信级，用于类比论证而非替代框架判断）",
    ...picked.map(x => fmtCase(x.c)),
    ...LEGACY_CASES,
    recLine,
  ].filter(Boolean);
  return lines.join("\n");
}
