/**
 * 判断工厂（judgment factory）——9/25 V3融入第二批：判断库的发动机
 * 解决9/18已知风险："结算cron空转（上游判断缺结构化失效条件）"
 *
 * 设计：13大师启发式的规则引擎化——每条规则=一个大师决策启发式的机械触发器
 *   触发产出结构化判断候选（五元组：symbol/stance/keyLevel/invalidation/confidence）
 *   失效条件全部带具体数字（对齐cron-judgment-settle的parseInvalidation机械核验口径）
 * 零AI调用：纯规则触发——不编观点，只记录"规则触发的信号"（零编造红线的工厂版）
 * 大师视角签名：每条候选标master字段（哪个启发式产生），输出时注明"规则触发信号，非大师本人观点"
 *
 * 数据源：qt.gtimg.cn实时行情（lib/qt.ts getQtStocks）
 * 产出：data/judgment_candidates.json（cron-judgment-settle核价结算）
 */

import { getQtStocks, type QtStock } from "./qt";

export const FACTORY_SYMBOLS = ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "KO", "MCD", "BRK.A"];

export interface JudgmentCandidate {
  id: string;
  symbol: string;
  stance: "多" | "空" | "观望";
  keyLevel: string;
  invalidation: string;
  confidence: string;
  master: string;
  basis: string;
  date: string;
  ts: number;
  status: "pending" | "settled";
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const mkId = (symbol: string, rule: string) => `jf_${rule}_${symbol}_${todayStr()}`;

/** 规则1：利弗莫尔——关键点确认（单日大异动=趋势信号，关键点=今日高点/低点） */
function livermoreRule(s: QtStock): JudgmentCandidate | null {
  if (s.changePct === null || s.high === null || s.low === null || !s.price) return null;
  if (Math.abs(s.changePct) < 5) return null;
  const up = s.changePct > 0;
  return {
    id: mkId(s.code, "livermore"), symbol: s.code,
    stance: up ? "多" : "空",
    keyLevel: up ? `突破确认位 ${s.high.toFixed(2)}` : `跌破确认位 ${s.low.toFixed(2)}`,
    invalidation: up
      ? `跌破 ${s.low.toFixed(2)}（今日低点失守=关键点失效）`
      : `突破 ${s.high.toFixed(2)}（今日高点收复=空头关键点失效）`,
    confidence: "55%", master: "利弗莫尔（关键点）",
    basis: `[数据]qt实时：单日${s.changePct > 0 ? "+" : ""}${s.changePct.toFixed(1)}%（规则触发信号，非大师本人观点）`,
    date: todayStr(), ts: Date.now(), status: "pending",
  };
}

/** 规则2：格雷厄姆——估值低位观察（PE<15且盈利，失效=PE升破20） */
function grahamRule(s: QtStock): JudgmentCandidate | null {
  if (s.pe === null || s.pe <= 0 || s.pe >= 15 || !s.price) return null;
  return {
    id: mkId(s.code, "graham"), symbol: s.code,
    stance: "观望",
    keyLevel: `PE ${s.pe.toFixed(1)}（<15观察阈值）`,
    invalidation: `PE升破 20（估值修复完成，观察信号失效）`,
    confidence: "50%", master: "格雷厄姆（估值低位）",
    basis: `[数据]qt实时：PE=${s.pe.toFixed(1)}（规则触发信号，非投资建议）`,
    date: todayStr(), ts: Date.now(), status: "pending",
  };
}

/** 规则3：马克斯——钟摆极端警示（单日±8%=情绪极端段，失效=回归±3%内） */
function marksRule(s: QtStock): JudgmentCandidate | null {
  if (s.changePct === null || Math.abs(s.changePct) < 8 || !s.price) return null;
  const greedy = s.changePct > 0;
  return {
    id: mkId(s.code, "marks"), symbol: s.code,
    stance: "观望",
    keyLevel: `钟摆${greedy ? "贪婪" : "恐惧"}段（单日${s.changePct > 0 ? "+" : ""}${s.changePct.toFixed(1)}%）`,
    invalidation: `涨跌幅回归 ±3% 以内（钟摆离开极端段，警示失效）`,
    confidence: "50%", master: "马克斯（钟摆定位）",
    basis: `[数据]qt实时：单日${s.changePct > 0 ? "+" : ""}${s.changePct.toFixed(1)}%（情绪极端警示，非方向判断）`,
    date: todayStr(), ts: Date.now(), status: "pending",
  };
}

/** 全池扫描→产出候选 */
export async function runFactory(): Promise<JudgmentCandidate[]> {
  const quotes = await getQtStocks(FACTORY_SYMBOLS);
  const out: JudgmentCandidate[] = [];
  quotes.forEach((s) => {
    if (!s.price) return;
    for (const rule of [livermoreRule, grahamRule, marksRule]) {
      const c = rule(s);
      if (c) out.push(c);
    }
  });
  return out;
}
