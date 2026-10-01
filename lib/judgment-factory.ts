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

export const FACTORY_SYMBOLS = ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "KO", "MCD", "BRK.A", "00700", "00857"]; // 10/1港股池扩容（评测缺口清单①）：00700腾讯/00857中石油——G-001/G-012题眼

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
  // Schema V2（10/1 Phase1）：时间盒/环境标签/执行层——失效严格度由settle机械判定，不在此自报
  timeBox: number; // 时间盒天数：短线信号5/估值观察60
  envTags: string; // 环境标签逗号串（财报周等，工厂侧尽力而为）
  execPlan: string; // 执行层：信号≠操作指令
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
      ? `跌破 ${s.low.toFixed(2)}（触发日低点失守=关键点失效）[信号完成]`
      : `突破 ${s.high.toFixed(2)}（触发日高点收复=空头关键点失效）[信号完成]`,
    confidence: "55%", master: "利弗莫尔（关键点）",
    basis: `[数据]qt实时：单日${s.changePct > 0 ? "+" : ""}${s.changePct.toFixed(1)}%（规则触发信号，非大师本人观点）`,
    date: todayStr(), ts: Date.now(), status: "pending",
    timeBox: 5, envTags: "单日大异动", execPlan: up ? `回踩 ${s.high.toFixed(2)} 不破可分批确认` : `反抽 ${s.low.toFixed(2)} 不过可分批确认`,
  };
}

/** 规则2：格雷厄姆——估值低位观察（PE<15且盈利，失效=PE升破20） */
function grahamRule(s: QtStock): JudgmentCandidate | null {
  if (s.pe === null || s.pe <= 0 || s.pe >= 15 || !s.price) return null;
  return {
    id: mkId(s.code, "graham"), symbol: s.code,
    stance: "观望",
    keyLevel: `PE ${s.pe.toFixed(1)}（<15观察阈值）`,
    invalidation: `突破 ${(s.price * 20 / (s.pe ?? 15)).toFixed(2)}（价格修复至PE约20，观察信号失效）[信号完成]`,
    confidence: "50%", master: "格雷厄姆（估值低位）",
    basis: `[数据]qt实时：PE=${s.pe.toFixed(1)}（规则触发信号，非投资建议）`,
    date: todayStr(), ts: Date.now(), status: "pending",
    timeBox: 60, envTags: "估值低位", execPlan: "观察信号：仅记录不构成操作，建仓需独立判断仓位规则",
  };
}

/** 规则3：马克斯——钟摆极端警示（单日±8%以上；失效=价格回归昨收±3%内——绝对点位可机械核验） */
function marksRule(s: QtStock): JudgmentCandidate | null {
  if (s.changePct === null || Math.abs(s.changePct) < 8 || !s.price) return null;
  const greedy = s.changePct > 0;
  const anchor = s.previousClose;
  if (!anchor) return null;
  const band = anchor * 1.03;
  const floor = anchor * 0.97;
  return {
    id: mkId(s.code, "marks"), symbol: s.code,
    stance: "观望",
    keyLevel: `钟摆${greedy ? "贪婪" : "恐惧"}段（单日${greedy ? "+" : ""}${s.changePct.toFixed(1)}%，昨收${anchor.toFixed(2)}）`,
    invalidation: greedy
      ? `跌破 ${floor.toFixed(2)}（价格回落至昨收-3%，情绪极端消解，警示失效）[信号完成]`
      : `突破 ${band.toFixed(2)}（价格收复至昨收+3%，情绪极端消解，警示失效）[信号完成]`,
    confidence: "50%", master: "马克斯（钟摆定位）",
    basis: `[数据]qt实时：单日${greedy ? "+" : ""}${s.changePct.toFixed(1)}%（情绪极端警示，非方向判断）`,
    date: todayStr(), ts: Date.now(), status: "pending",
    timeBox: 5, envTags: "情绪极端", execPlan: "警示信号：情绪钟摆定位，不构成方向判断与操作指令",
  };
}

/** 全池扫描→产出候选（财报触发器：本周有财报的标的候选带环境标签，结算错账复盘可用环境维度——宪法2） */
export async function runFactory(): Promise<JudgmentCandidate[]> {
  const quotes = await getQtStocks(FACTORY_SYMBOLS);
  // 财报触发器（10/1 Phase1第2项）：纳斯达克本周日历，命中工厂池标的→env_tags追加"财报周(MM-DD发布)"
  // 容错：财报源失败不挡工厂主流程（信号照常产出，只是无环境标签）
  const earningsMap = new Map<string, string>();
  try {
    const { getThisWeekEarnings } = await import("./chat-earnings-context");
    const entries = await getThisWeekEarnings();
    const pool = new Set(FACTORY_SYMBOLS);
    for (const e of entries) {
      if (pool.has(e.symbol) && !earningsMap.has(e.symbol)) {
        earningsMap.set(e.symbol, `财报周(${e.date.slice(5)}${e.hour === "bto" ? "盘前" : e.hour === "amc" ? "盘后" : ""}发布)`);
      }
    }
  } catch {
    // 财报日历不可用：静默降级
  }
  const out: JudgmentCandidate[] = [];
  quotes.forEach((s) => {
    if (!s.price) return;
    for (const rule of [livermoreRule, grahamRule, marksRule]) {
      const c = rule(s);
      if (c) {
        const ear = earningsMap.get(s.code);
        if (ear) c.envTags = c.envTags ? `${c.envTags},${ear}` : ear;
        out.push(c);
      }
    }
  });
  return out;
}

/**
 * 工厂扫描→去重→入账（10/1 Phase1：Vercel Hobby计划cron必须daily，"0 21 * * 1-5"从未注册过
 * →工厂从未自动跑过（ledger 0行实锤）。修复=settle内嵌工厂前置：每日一条龙"扫描→结算→推送"，
 * 本函数供cron-judgment-settle与cron-judgment-factory共用，替代各自维护去重逻辑）
 */
export async function runFactoryAndInsert(): Promise<{ produced: number; inserted: number; items: { symbol: string; master: string }[] }> {
  const { insertLedgerRows, readAllLedger } = await import("./supabase");
  const produced = await runFactory();
  if (!produced.length) return { produced: 0, inserted: 0, items: [] };

  // 去重：同symbol+同date+同invalidation已有账本行则跳过
  const existing = (await readAllLedger(500)) ?? [];
  const seen = new Set(existing.map((r) => `${r.symbol}|${r.date}|${r.invalidation ?? ""}`));
  const fresh = produced.filter((c) => {
    const key = `${c.symbol}|${c.date}|${c.invalidation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!fresh.length) return { produced: produced.length, inserted: 0, items: [] };

  const ok = await insertLedgerRows(
    fresh.map((c) => ({
      symbol: `${c.symbol}(${c.master.split("（")[0]}信号)`,
      stance: c.stance,
      key_level: c.keyLevel,
      invalidation: c.invalidation,
      confidence: c.confidence,
      date: c.date,
      ts: String(c.ts),
      // Schema V2（10/1 Phase1）：时间盒/环境标签/执行层随行入账
      time_box: c.timeBox,
      env_tags: c.envTags,
      exec_plan: c.execPlan,
    }))
  );
  return {
    produced: produced.length,
    inserted: ok ? fresh.length : 0,
    items: fresh.map((c) => ({ symbol: c.symbol, master: c.master })),
  };
}
