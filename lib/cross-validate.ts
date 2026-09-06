import "server-only";

const ABSOLUTE_TERMS: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  { pattern: /永久(?!\s*(?:不|失效|关闭))/g, replacement: "长期", label: "永久→长期" },
  { pattern: /免费(?!版|额度|试用|方案|层)(?=服务|提供|使用|无限期|永久)/g, replacement: "有限期免费", label: "免费→有限期免费" },
  { pattern: /全自动(?!驾驶|化生产)/g, replacement: "高度自动化", label: "全自动→高度自动化" },
  { pattern: /趋近于\s*0/g, replacement: "极低", label: "趋近于0→极低" },
  { pattern: /不会(?:出错|发生故障|失败|丢失)/g, replacement: "极少出错", label: "不会出错→极少出错" },
  { pattern: /百分之百/g, replacement: "高概率", label: "百分之百→高概率" },
  { pattern: /零风险/g, replacement: "低风险", label: "零风险→低风险" },
  { pattern: /保证(?:不)?(?:会)?(?:出错|失败|亏损|损失)/g, replacement: "最大限度降低风险", label: "保证不出错→最大限度降低风险" },
  { pattern: /完全(?:安全|可靠|准确)/g, replacement: "较为安全可靠", label: "完全安全→较为安全可靠" },
];

const HIGH_RISK_PATTERNS: Array<{ topic: string; pattern: RegExp; disclaimer: string }> = [
  {
    topic: "医疗",
    pattern: /(诊断|治疗|药物|症状|疾病)/,
    disclaimer: "以上涉及医疗内容仅供参考，不构成医疗诊断或治疗建议，请咨询持牌医师。",
  },
  {
    topic: "法律",
    pattern: /(诉讼策略|具体案件|赔偿标准|法定程序)/,
    disclaimer: "以上涉及法律内容仅供参考，不构成法律意见，请咨询执业律师。",
  },
  {
    topic: "投资",
    pattern: /(买入|卖出|加仓|减仓|具体收益|保证收益|稳赚|盈亏|收益率|止损|止盈|仓位|估值|PE|PB|ROE|评分|基本面|技术面|行情|股价|市值|财报|盈利|亏损|投资)/,
    disclaimer: "以上涉及投资内容仅供参考，不构成投资建议，投资有风险，决策需谨慎。",
  },
];

export type CrossValidationResult = {
  text: string;
  flags: string[];
  cleaned: boolean;
};

export function crossValidate(text: string): CrossValidationResult {
  const flags: string[] = [];
  let cleaned = text;

  for (const { pattern, replacement, label } of ABSOLUTE_TERMS) {
    if (pattern.test(cleaned)) {
      flags.push(label);
      cleaned = cleaned.replace(pattern, replacement);
    }
  }

  for (const { topic, pattern, disclaimer } of HIGH_RISK_PATTERNS) {
    if (pattern.test(cleaned) && !/仅供参考|仅供研究参考|不构成.*意见|不构成.*建议|以实际|请咨询/.test(cleaned)) {
      flags.push(`${topic}话题缺边界标注`);
      cleaned += `\n\n${disclaimer}`;
    }
  }

  return { text: cleaned, flags, cleaned: flags.length > 0 };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9/6 深度优化：数字锚定验证（D4规则的事后闭环）
// 技能包要求"草稿数字与注入数据逐一核对"，但此前纯靠模型自律——
// 本层在流完成后真实执行比对：回答中该标的价格类数字与注入行情不符→末尾附核对警告
// 设计原则：只报告不patch（答案里合法存在用户口述数字如成本价，自动改写有误伤风险）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type InjectedQuote = {
  code: string;
  name?: string;
  price: number | null;
  previousClose: number | null;
  open?: number | null;
  high: number | null;
  low: number | null;
  changePct: number | null;
  history?: {
    oneMonthAgo: number | null;
    threeMonthsAgo: number | null;
    monthHigh: number | null;
    monthLow: number | null;
    // 9/6锚点扩展（与HistoryAnchors对齐，全可空——3mo降级路径下为null）
    sixMonthsAgo?: number | null;
    ytdStart?: number | null;
    fiftyTwoWeekHigh?: number | null;
    fiftyTwoWeekLow?: number | null;
    // 9/6质量优化：MA均线锚（现价vs均线位置是趋势排列的直接依据，引用不得误报漂移）
    ma20?: number | null;
    ma50?: number | null;
    ma200?: number | null;
  } | null;
};

/** 数字相同判定：相对容差0.5%（两源行情+四舍五入的自然偏差） */
function sameNumber(a: number, b: number, tolerance = 0.005): boolean {
  return Math.abs(a - b) <= Math.abs(b) * tolerance;
}

/** 提取文本中所有带$的价格数字与裸百分比（while+exec——es5 target下for..of matchAll报TS2802） */
function extractPriceLike(text: string): number[] {
  const out: number[] = [];
  const re = /\$(\d{1,6}(?:\.\d{1,4})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) out.push(parseFloat(m[1]));
  return out;
}
function extractPct(text: string): number[] {
  const out: number[] = [];
  const re = /([+-]?\d{1,3}(?:\.\d{1,2})?)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) out.push(parseFloat(m[1]));
  return out;
}

/**
 * 数字锚定验证。
 * 仅当回答提及了某注入标的（代码或名称）且回答里存在疑似漂移数字时报告：
 * 疑似漂移 = 该数字在注入价±15%区间内但精确比对不匹配（0.5%容差），
 * 且不属于注入白名单（现价/昨收/开/高/低/历史锚点）。
 * "成本/成本价/买入价"邻近±20字符的$数字视为用户口述，跳过（防误伤）。
 */
export function verifyNumericAnchors(
  text: string,
  quotes: Array<InjectedQuote>,
): { text: string; flags: string[]; verified: boolean } {
  const flags: string[] = [];
  const warnings: string[] = [];

  if (quotes.length === 0) return { text, flags, verified: false };

  for (const quote of quotes) {
    const { code, name, price, previousClose, open, high, low, changePct, history } = quote;
    if (price == null) continue;

    // 标的提及检测（代码精确边界，名称防止"苹果"撞"苹果公司财务"等）
    const codeRe = new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const nameRe = name && name.length >= 2 ? new RegExp(name, "i") : null;
    if (!codeRe.test(text) && !(nameRe && nameRe.test(text))) continue;

    // 注入白名单数字集（命中任一=合法锚定）
    const whitelist: number[] = [price, previousClose, open, high, low].filter(
      (v): v is number => v != null,
    );
    if (history) {
      // 历史锚点字段可空（Yahoo降级路径）——null过滤后再push（直接push会在strict下类型报错）
      // 9/6锚点扩展：6月前/年初/52周高低进白名单——AI按注入数据引用这些锚点时不得误报"价格漂移"
      whitelist.push(
        ...[
          history.oneMonthAgo, history.threeMonthsAgo, history.monthHigh, history.monthLow,
          history.sixMonthsAgo, history.ytdStart, history.fiftyTwoWeekHigh, history.fiftyTwoWeekLow,
          history.ma20, history.ma50, history.ma200,
        ].filter((v): v is number => v != null),
      );
    }

    // 用户口述数字豁免：成本/买入价语境±20字符内的$数字跳过
    // 技术位语境豁免：AI做条件分支是核心功能（"回调至20日线附近$210-215"是目标位不是行情引用）
    const userOwned = new Set<number>();
    const userRe = /\$(\d{1,6}(?:\.\d{1,4})?)/g;
    let um: RegExpExecArray | null;
    while ((um = userRe.exec(text)) != null) {
      const idx = um.index ?? 0;
      const ctx = text.slice(Math.max(0, idx - 20), idx + 25);
      if (/成本|买入价|建仓|你的|持仓价/i.test(ctx)) userOwned.add(parseFloat(um[1]));
      // 技术位词汇窗口更宽（±30字符：目标位描述常常前置长定语"回调至20日均线附近（约$210-215）"）
      const techCtx = text.slice(Math.max(0, idx - 30), idx + 35);
      if (/均线|回调至|回踩|目标位|支撑位?|压力位?|阻力|买入区间|加仓位?|减仓位?|止盈位?|止损位?|附近|左右|区间|期望|预计|预测|看(涨|跌)到|回到/i.test(techCtx)) {
        userOwned.add(parseFloat(um[1]));
      }
    }

    const candidates = extractPriceLike(text).filter(
      (n) => !userOwned.has(n)
        && whitelist.every((w) => !sameNumber(n, w))
        && n >= price * 0.85 && n <= price * 1.15,
    );
    if (candidates.length > 0) {
      const uniq = Array.from(new Set(candidates.map((n) => n))).slice(0, 3);
      warnings.push(
        `${code}：回答中出现$${uniq.join("、$")}，与注入实时价$${price.toFixed(2)}（±0.5%）不符，请以上方注入数据为准`,
      );
      flags.push(`${code}价格数字疑似漂移:${uniq.join(",")}`);
    }

    // 涨跌幅漂移：答案百分比 vs 注入changePct（差>0.3且<5=疑似，差≥5多为区间涨跌非当日，跳过）
    // 9/6锚点扩展：区间语义豁免——"年内/年初至今/近1月/近6月/52周回撤"等百分比是区间涨跌，
    // 幅度小(差<5)时会撞当日口径检测误报。带位置提取，语境含区间词的百分比跳过
    if (changePct != null) {
      const rangeWord =
        /年内|年初|至今|YTD|近1月|近3月|近6月|近一月|近三月|近六月|1个月|3个月|6个月|三个月|六个月|52周|一年|1年|回撤|涨了|累计|区间/;
      const pcts: number[] = [];
      const pctRe = /([+-]?\d{1,3}(?:\.\d{1,2})?)\s*%/g;
      let pm: RegExpExecArray | null;
      while ((pm = pctRe.exec(text)) != null) {
        const idx = pm.index ?? 0;
        const ctx = text.slice(Math.max(0, idx - 24), idx + 10);
        if (rangeWord.test(ctx)) continue; // 区间语义百分比不参与当日口径比对
        pcts.push(parseFloat(pm[1]));
      }
      const suspects = pcts.filter(
        (p) => Math.abs(Math.abs(p) - Math.abs(changePct)) > 0.3
          && Math.abs(Math.abs(p) - Math.abs(changePct)) < 5,
      );
      if (suspects.length > 0) {
        const uniq = Array.from(new Set(suspects.map((p) => p))).slice(0, 2);
        warnings.push(
          `${code}：回答涨跌幅${uniq.map((p) => `${p > 0 ? "+" : ""}${p}%`).join("、")}与注入当日涨跌${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%不一致（若为区间涨跌请核对口径）`,
        );
        flags.push(`${code}涨跌幅口径存疑:${uniq.join(",")}`);
      }
    }
  }

  if (warnings.length === 0) return { text, flags, verified: false };

  const note = `\n\n⚠️ **数据核对提示**（系统自动比对注入行情）：${warnings.join("；")}。`;
  return { text: `${text}${note}`, flags, verified: true };
}
