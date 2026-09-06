/**
 * 数字回验器（9/6 深度质量优化）
 *
 * 背景：红队case2实证chat路径存在AI算数方差（两样本一错一对）——review路径已用facts收口，
 * chat路径此前零校验。S1要求AI展示算式，算式是确定性结构→本地重算零误判。
 *
 * 设计原则（防误报优先于覆盖率）：
 * 1. 算式重算：匹配"(a-b)/c×100=d%"模式，本地重算对照，容差0.15个百分点（四舍五入级）——零误判
 * 2. 引用数字对错（现价/锚点/涨跌幅）由cross-validate.ts的verifyNumericAnchors管——分工不重叠
 * 3. 不验证定性结论——那些不是"错"是"观点"
 * 4. 输出为附加提示段（非静默修正）：判定权在用户
 */

import "server-only";

export type InjectedQuote = {
  code: string;
  price: number | null;
};

export type VerifyIssue = {
  kind: "算式";
  detail: string;
};

export type VerifyResult = {
  checkedCount: number;
  issues: VerifyIssue[];
  report: string; // 附加到回答尾部的提示段（无可验证项时为空串）
};

// 全角符号归一：−→- ×→* ％→% （）→() ＝→= ，去千分位逗号
function normalizeNumeric(text: string): string {
  return text
    .replace(/−/g, "-")
    .replace(/[×xX]/g, "*")
    .replace(/％/g, "%")
    .replace(/＝/g, "=")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/(\d),(\d{3})\b/g, "$1$2");
}

// 算式模式：(a-b)/c*100=d（%可有可无）。S1强制AI展示算式，命中率高
const FORMULA_PATTERN = /\((\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\)\s*\/\s*(\d+(?:\.\d+)?)\s*\*\s*100\s*=\s*([+-]?\d+(?:\.\d+)?)\s*%?/g;

const ARITH_TOLERANCE = 0.15; // 个百分点

export function verifyNumbers(text: string, _quotes: InjectedQuote[]): VerifyResult {
  const normalized = normalizeNumeric(text);
  const issues: VerifyIssue[] = [];
  let checkedCount = 0;

  // 算式重算：AI按S1展示的涨跌幅算式本地重算（纯数学，零误判）
  const formulaPattern = new RegExp(FORMULA_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = formulaPattern.exec(normalized)) !== null) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const c = Number(match[3]);
    const claimed = Number(match[4]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || c === 0) continue;
    const recomputed = ((a - b) / c) * 100;
    checkedCount++;
    if (Math.abs(recomputed - claimed) > ARITH_TOLERANCE) {
      issues.push({
        kind: "算式",
        detail: `${match[0]} → 正确值应为${recomputed >= 0 ? "+" : ""}${recomputed.toFixed(2)}%`,
      });
    }
  }

  // 无可验证项：不打扰
  if (checkedCount === 0) {
    return { checkedCount, issues, report: "" };
  }

  const report = issues.length === 0
    ? `\n\n【算式核对】✅ 系统重算了本回答的${checkedCount}处涨跌幅算式，全部正确。`
    : `\n\n【算式核对】⚠️ 系统重算发现${issues.length}处算式错误，请以下方修正为准：\n${issues
        .slice(0, 5)
        .map((issue, i) => `${i + 1}. ${issue.detail}`)
        .join("\n")}${issues.length > 5 ? `\n（其余${issues.length - 5}处略）` : ""}`;

  return { checkedCount, issues, report };
}
