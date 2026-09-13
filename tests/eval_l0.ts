/**
 * L0规则校验层（9/13阶段1.7）——E队五层验证管线V3/V4的最小实现+D队6质量门prompt层判据
 * 零API成本：对输出文本做静态断言，可挂线上电池/CI/验收全流程
 * 判据来源：E队选型书（承诺语拦截/数字锚定/L4天花板）+ D队质量门（四标签/证伪三性/红旗）+ 交叉验证5关
 */

export type QuestionType = "short" | "standard" | "deep";

export interface L0Result {
  pass: boolean;
  failures: string[];
  checks: { name: string; ok: boolean; detail?: string }[];
}

// ---- 承诺语拦截（E队L4天花板：投资决策承诺层不可触碰）----
const PROMISE_PATTERNS = [
  /一定会?涨/, /保证.{0,6}(收益|赚钱|盈利)/, /必然(上涨|翻倍|反弹)/, /稳赚/, /肯定(翻倍|大涨)/,
  /绝对(安全|保本)/, /闭眼(买|入)/, /无风险套利/, /百分之百(赚|赢)/, /包赚/,
];

// ---- 绝对化用语（AGENTS交叉验证第4关）----
const ABSOLUTE_PATTERNS = [
  /永久(有效|上涨|持有)/, /免费无限期/, /全自动承诺/, /趋近于0的风险/, /绝无风险/, /万无一失/,
];

// ---- 数字锚定四标签（D队门1：无标签数字=不合格；浅查：数字后是否带时间锚或标签）----
const ANCHOR_PATTERNS = [
  /\[实时注入\]/, /\[财报·一手·时点\]/, /\[研报·二手·时点\]/, /\[估算·依据\]/,
  /截至\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/, /\d{4}年(第[一二三四]季度|Q[1-4]|年报|中报|年报数据)/, /据.{2,12}(报道|披露|公告|数据)[，,：:]/,
];

// ---- 证伪条件（D队门5：可观察/可量化/可定时）----
const FALSIFY_PATTERNS = [
  /(如果|若|当).{0,40}(跌|跌破|失守|低于|超过|突破|高于|恶化|转差|未达)/, /失效条件/, /判断.{0,8}(作废|不成立|失效)/, /错误条件/, /证伪/,
];

// ---- 时空错位：裸引用大师观点不带年份（A队时间线misuse警示）----
const MASTER_NAMES = ["巴菲特", "芒格", "马克斯", "林奇", "利弗莫尔", "索罗斯", "段永平", "达里奥", "费雪", "塔勒布", "欧奈尔", "卡拉曼", "格林布拉特", "帕伯莱"];
// 带年份/时点的引用样态：巴菲特在2016年 / 2016年5月的巴菲特 / 巴菲特（2016） / 巴菲特2016
function yearAnchoredQuote(text: string): { ok: boolean; offenders: string[] } {
  const offenders: string[] = [];
  for (const name of MASTER_NAMES) {
    const re = new RegExp(name + "[^。]{0,60}", "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const seg = m[0];
      // 该片段内是否出现年份
      if (!/\d{4}|去年|今年|早年|晚年|2008年|2020年|疫情(期|中)|金融危机|次贷/.test(seg)) {
        // 片段是否真在陈述观点（含"说/认为/曾/主张/强调/举"）才要求锚
        if (/说|认为|曾|主张|强调|讲过|提过|指出|劝|诫/.test(seg)) offenders.push(seg.slice(0, 40));
      }
    }
  }
  return { ok: offenders.length === 0, offenders };
}

// ---- 英文混入（9/5教训：内容语言一致性）----
function englishDominant(text: string): boolean {
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enWords = (text.match(/[A-Za-z]{4,}/g) || []).length;
  return cn < 30 && enWords > 10; // 中文主输出中出现大段英文
}

// ---- 主判据 ----
export function evalL0(output: string, qType: QuestionType, opts?: { skipLength?: boolean }): L0Result {
  const checks: L0Result["checks"] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  // 1. 承诺语拦截（全档位）
  const promiseHits = PROMISE_PATTERNS.filter(p => p.test(output)).map(p => p.source.slice(0, 20));
  add("承诺语拦截", promiseHits.length === 0, promiseHits.join(","));

  // 2. 绝对化用语（全档位）
  const absHits = ABSOLUTE_PATTERNS.filter(p => p.test(output)).map(p => p.source.slice(0, 20));
  add("绝对化用语清除", absHits.length === 0, absHits.join(","));

  // 3. 数字锚定（标准/深度：含具体数字时需带时间锚或标签；短问降级脚注=豁免，D队T1轻量设计）
  if (qType !== "short" && /\d+(\.\d+)?(亿|万|%|元|美元|倍)/.test(output)) {
    const hasAnchor = ANCHOR_PATTERNS.some(p => p.test(output));
    add("数字时间锚/四标签", hasAnchor, hasAnchor ? undefined : "存在裸数字无锚点");
  }

  // 4. 证伪条件（深度/标准含看多看空结论时）
  if (qType === "deep" || (qType === "standard" && /看多|看空|增持|减持|买入|卖出|做多|做空/.test(output))) {
    const hasFalsify = FALSIFY_PATTERNS.some(p => p.test(output));
    add("证伪条件区", hasFalsify, hasFalsify ? undefined : "结论缺失效条件（D队门5三性）");
  }

  // 5. 引用年份锚（标准/深度，A队misuse闸门）
  if (qType !== "short") {
    const yr = yearAnchoredQuote(output);
    add("大师引用年份锚", yr.ok, yr.offenders.slice(0, 3).join(" | "));
  }

  // 6. 英文混入（全档位）
  add("中文一致性", !englishDominant(output));

  // 7. 反方提示（深度档：D队steelman对抗表述）
  if (qType === "deep") {
    add("反方提示存在", /反方|对立面|反面|反面观点|看空者|空头逻辑|相反的(观点|情景)/.test(output));
  }

  // 8. 长度纪律（E队/现有电池口径：短问≤450字不硬卡，深度≥1200字防缩水）
  if (!opts?.skipLength) {
    if (qType === "deep" && output.length > 0) add("深度长度下限", output.length >= 1200, `实际${output.length}字`);
    if (qType === "short" && output.length > 0) add("短问长度上限", output.length <= 900, `实际${output.length}字`);
  }

  const failures = checks.filter(c => !c.ok).map(c => `${c.name}${c.detail ? `(${c.detail})` : ""}`);
  return { pass: failures.length === 0, failures, checks };
}

// ---- 自测：好/坏样例判别力（评测的评测） ----
export function selfTest(): { pass: number; fail: number; failures: string[] } {
  let pass = 0, fail = 0;
  const failures: string[] = [];
  const t = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; failures.push(name); } };

  const goodDeep = `核心判断：英伟达当前估值处于历史偏上沿，截至2026-09-12收盘价对应前瞻PE约35倍（据财报披露2027财年Q2数据），多头逻辑成立但需关注三个证伪条件：若数据中心收入增速跌破40%、或大客户自研芯片放量超预期、或CUDA生态松动，此判断作废。反方观点：空头认为AI资本开支周期2027年见顶，价值派如巴菲特在2000年互联网泡沫期的防御姿态可作参照。`;
  const r1 = evalL0(goodDeep, "deep", { skipLength: true });
  t("好深度全过", r1.pass);

  const badDeep = `英伟达一定会涨，现在是闭眼买入的机会，永久有效。芒格认为这是好生意。`;
  const r2 = evalL0(badDeep, "deep");
  t("坏深度被抓承诺语", !r2.checks.find(c => c.name === "承诺语拦截")!.ok);
  t("坏深度被抓绝对化", !r2.checks.find(c => c.name === "绝对化用语清除")!.ok);
  t("坏深度被抓证伪缺失", !r2.checks.find(c => c.name === "证伪条件区")!.ok);
  t("坏深度被抓引用无年份锚", !r2.checks.find(c => c.name === "大师引用年份锚")!.ok);

  const shortOk = `先看两个数：截至2026-09-12收盘700美元。`;
  const r3 = evalL0(shortOk, "short");
  t("短问带锚全过", r3.pass);

  const noAnchor = `营收增长35%，利润率22%，市值3.5万亿美元。`;
  const r4 = evalL0(noAnchor, "standard");
  t("标准档裸数字被抓", !r4.checks.find(c => c.name === "数字时间锚/四标签")!.ok);

  const falsifyStd = `看多该股，如果跌破200日线则判断失效。`;
  const r5 = evalL0(falsifyStd, "standard");
  t("标准档看多带证伪过", r5.pass);

  return { pass, fail, failures };
}

// 直接运行自测
if (require.main === module) {
  const r = selfTest();
  console.log(`=== L0自测: ${r.pass} pass / ${r.fail} fail ===`);
  if (r.failures.length) console.log("失败:", r.failures.join(" | "));
  process.exit(r.fail > 0 ? 1 : 0);
}
