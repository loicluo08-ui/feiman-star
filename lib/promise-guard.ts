/**
 * 承诺语拦截（9/13阶段1.1，E队L4天花板落地）——投资决策承诺层不可触碰
 * 架构：句级检出→拦截改写+尾部明示（透明化，不静默吞句——用户视角纪律）
 * 消费方：route.ts后置校验链（patch）+ tests/eval_l0.ts（L0判据同源，防生产/评测漂移）
 */

export const PROMISE_PATTERNS: RegExp[] = [
  /一定会?涨/, /保证.{0,6}(收益|赚钱|盈利)/, /必然(上涨|翻倍|反弹)/, /稳赚/, /肯定(翻倍|大涨)/,
  /绝对(安全|保本)/, /闭眼(买|入)/, /无风险套利/, /百分之百(赚|赢)/, /包赚/,
];

export const ABSOLUTE_PATTERNS: RegExp[] = [
  /永久(有效|上涨|持有)/, /免费无限期/, /全自动承诺/, /趋近于0的风险/, /绝无风险/, /万无一失/,
];

export interface PromiseGuardResult {
  cleaned: boolean;
  text: string;
  flags: string[];
}

function splitSentences(text: string): string[] {
  // 中文句子切分：终止标点保留在句内
  return text.split(/(?<=[。！？；\n])/).filter(s => s.length > 0);
}

export function guardPromises(input: string): PromiseGuardResult {
  const flags: string[] = [];
  const sentences = splitSentences(input);
  const kept: string[] = [];
  let blocked = 0;

  for (const s of sentences) {
    const hitPromise = PROMISE_PATTERNS.some(p => p.test(s));
    const hitAbsolute = ABSOLUTE_PATTERNS.some(p => p.test(s));
    if (hitPromise || hitAbsolute) {
      blocked++;
      flags.push(`拦截: ${s.trim().slice(0, 40)}`);
      continue; // 丢弃承诺句
    }
    kept.push(s);
  }

  if (blocked === 0) return { cleaned: false, text: input, flags };

  let text = kept.join("");
  const notice = `\n\n---\n\n⚠️ 已拦截${blocked}处承诺性/绝对化表述（投资分析不提供收益承诺，原句见上方被移除处语境）。`;
  text += notice;
  return { cleaned: true, text, flags };
}
