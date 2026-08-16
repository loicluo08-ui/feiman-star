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
    pattern: /(买入|卖出|加仓|减仓|具体收益|保证收益|稳赚|盈亏|收益率|止损|止盈|仓位)/,
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
    if (pattern.test(cleaned) && !/仅供参考|不构成.*意见|以实际|请咨询/.test(cleaned)) {
      flags.push(`${topic}话题缺边界标注`);
      cleaned += `\n\n${disclaimer}`;
    }
  }

  return { text: cleaned, flags, cleaned: flags.length > 0 };
}
