/**
 * 来源完整性校验（9/6输出质量优化·诚信层）
 *
 * live实测发现的缺陷：模型把训练记忆里的历史事实标成[数据]——
 *   例1："过去4个季度净利润同比增速约70-120%（[数据] 财报）"——系统只注入了行情，没注入财报
 *   例2："2022年NVDA从$346跌到$108"——历史价格非注入数据
 * 对高要求用户（框架创立人）这是诚信级缺陷：标注[数据]=声称"系统数据源可查"，
 * 一旦用户发现该数字系统根本没注入过，所有[数据]标注的信任全部崩塌。
 *
 * 修复策略（后置patch，与crossValidate同模式）：
 * - [数据]标签所在行的数字，必须能在注入池（行情/锚点/VIX文本+知识库）找到
 * - 找不到→该行[数据]降级为[模型记忆]（新标签：AI训练数据，可能过时/偏差）
 * - 豁免：算式中间值（紧邻≈=×÷/）、年份（19xx/20xx）、整数计数（"3个维度"类小整数）
 *
 * 设计取舍：宁枉勿纵——误降级（把真数据标成模型记忆）只损失展示精度；
 * 漏降级（幻觉冒充数据）直接烧信任。但年份/算式/小整数豁免把误降级压到最低。
 */

import { FEIMANSTAR_KB } from "./feimanstar-kb";

export interface SourcePool {
  numbers: Set<string>; // 归一化数字串（去逗号去符号）
}

interface QuoteLike {
  price?: number | null;
  pe?: number | null;
  changePct?: number | null;
  marketCap?: number | null;
  previousClose?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  history?: Record<string, number | null> | null;
}

// 归一化：去逗号去前导符号，保留数字本体
function normNum(raw: string): string {
  return raw.replace(/[+,\s$]/g, "").replace(/^-/, "");
}

// 从一段文本提取所有数字token（$123.45 / 1,234 / 12.3% / $5,342B）
function extractNumbers(text: string): Array<{ num: string; prevChar: string }> {
  const out: Array<{ num: string; prevChar: string }> = [];
  const re = /(\d[\d,]*(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // 数字串至少2位或含小数点——单数字（"3个维度"）不参与校验
    const digits = m[1].replace(/[,.]/g, "");
    if (digits.length >= 2) {
      const idx = m.index;
      let before = text.slice(Math.max(0, idx - 6), idx).trimEnd();
      // $是货币符号："$183.5"前面真正的语义字符是$前面的（≈$183.5→≈）
      before = before.replace(/\$+$/, "");
      const prevChar = before ? before[before.length - 1] : "";
      out.push({ num: normNum(m[1]), prevChar });
    }
  }
  return out;
}

// 数字是否豁免（非注入但合法）
function isExempt(num: string, prevChar: string): boolean {
  // 年份 19xx/20xx
  if (/^(19|20)\d{2}$/.test(num)) return true;
  // 算式中间值：数字前紧邻运算符（≈=×÷/*）——S1算式展示的推导结果
  // （$已在extractNumbers里跳过：≈$183.5的prevChar=≈）
  if (/[≈=×÷/*]/.test(prevChar)) return true;
  return false;
}

let kbNumbersCache: Set<string> | null = null;

// 知识库数字池（懒加载缓存）——特征提取，非全文数字：
// KB是方法论不是财报，全文裸数字多为叙述（"从100涨到150跌到120"），
// 收全文会让模型编的数撞池误放。只收三类"真基准"：
// ① %形式（模块5阈值"70%"、恐惧贪婪刻度）
// ② PE/PB/ROE/中值上下文的估值数字（模块1行业表"PE | 20 | 28 | 45+"）
// ③ X倍形式（"仓位1.5倍上限"）
// 注：matchAll的for..of在es5 target报TS2802（8/21已知坑）——统一while+exec
function kbNumbers(): Set<string> {
  if (kbNumbersCache) return kbNumbersCache;
  const set = new Set<string>();
  const collect = (re: RegExp) => {
    let m: RegExpExecArray | null;
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    while ((m = rx.exec(FEIMANSTAR_KB)) !== null) {
      if (m[1]) set.add(normNum(m[1]));
    }
  };
  // ① %形式
  collect(/(\d[\d,]*(?:\.\d+)?)\s*%/);
  // ② 估值基准数字，两种紧凑形式（±25字符窗口会把"PE | $0.80 × 100 = $120"里的120误收）：
  //    a. markdown表格管道行："| 20 | 28 | 45+"（模块1行业基准表）
  //    b. 标签紧邻："PE 28" / "PB:1.5" / "ROE≈12"（正文叙述形式）
  collect(/\|\s*(\d[\d,]*(?:\.\d+)?)/);
  collect(/\b(?:PE|PB|ROE)\s*[:：≈]?\s*(\d[\d,]*(?:\.\d+)?)/);
  // ③ 倍数形式
  collect(/(\d[\d,]*(?:\.\d+)?)\s*倍/);
  kbNumbersCache = set;
  return set;
}

/**
 * 构建注入数字池：行情结构数字 + VIX系列 + 注入文本数字（含快讯/锚点）+ 知识库基准。
 * 注入文本形式收录（如"市值$5,342B"的5342）——模型按注入文本格式引用，按同形式匹配。
 * mood为route的MarketMood（vix/vixPrevClose/vixHigh5d/vixLow5d）。
 */
export interface MarketMoodLike {
  vix: number;
  vixPrevClose?: number;
  vixHigh5d?: number;
  vixLow5d?: number;
}

export function buildSourcePool(
  quotes: QuoteLike[],
  mood: MarketMoodLike | null,
  injectedText: string,
): SourcePool {
  const numbers = new Set<string>(kbNumbers());
  const addNum = (n: number | null | undefined) => {
    if (n == null || !isFinite(n)) return;
    numbers.add(normNum(String(n)));
    // 市值类大数：行情源给的是原值（如5342000000000），注入文本写$5,342B——
    // 两种形式都收（B/T/K缩写与全数字）
    if (Math.abs(n) >= 1e9) {
      numbers.add(normNum(String(Math.round(n / 1e9))));
      numbers.add(normNum(String(Math.round(n / 1e12))));
      numbers.add((n / 1e12).toFixed(2).replace(/\.?0+$/, ""));
      numbers.add((n / 1e9).toFixed(1).replace(/\.?0+$/, ""));
    }
  };
  for (const q of quotes) {
    addNum(q.price);
    addNum(q.pe);
    addNum(q.changePct);
    addNum(q.marketCap);
    addNum(q.previousClose);
    addNum(q.open);
    addNum(q.high);
    addNum(q.low);
    addNum(q.volume);
    if (q.history) {
      for (const v of Object.values(q.history)) addNum(v);
    }
  }
  if (mood) {
    addNum(mood.vix);
    addNum(mood.vixPrevClose);
    addNum(mood.vixHigh5d);
    addNum(mood.vixLow5d);
  }
  // 注入文本全文数字（含锚点推导出的百分比、区间描述等）
  for (const { num } of extractNumbers(injectedText)) numbers.add(num);
  return { numbers };
}

export interface SourceVerifyResult {
  verified: boolean; // 有降级发生
  text: string; // 修正后全文
  flags: string[]; // 降级明细（log用）
}

/**
 * 校验[数据]标签行：行内出现池外数字（非豁免）→ [数据]降级[模型记忆]。
 * 只处理[数据]；[推导]/[经验]/[模型记忆]不动——它们本来就声明了非注入属性。
 */
export function verifySourceLabels(text: string, pool: SourcePool): SourceVerifyResult {
  const flags: string[] = [];
  const lines = text.split("\n");
  const outLines: string[] = [];

  for (const line of lines) {
    if (line.includes("[数据]")) {
      const nums = extractNumbers(line);
      const violations: string[] = [];
      for (const { num, prevChar } of nums) {
        if (isExempt(num, prevChar)) continue;
        if (pool.numbers.has(num)) continue;
        violations.push(num);
      }
      if (violations.length > 0) {
        outLines.push(line.replace(/\[数据\]/g, "[模型记忆]"));
        flags.push(`降级[模型记忆]: 池外数字${violations.join("/")}`);
      } else {
        outLines.push(line);
      }
    } else {
      outLines.push(line);
    }
  }

  if (flags.length === 0) {
    return { verified: false, text, flags };
  }
  return { verified: true, text: outLines.join("\n"), flags };
}
