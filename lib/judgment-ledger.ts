/**
 * 判断记账（judgment ledger）——投资对话的跨会话判断追踪
 * 逸翔9/12指令：AI对自己历史判断的记账、回访、对错归因——给投资对话加"框架之外的增量"
 *
 * 存储：前端localStorage（投资版无认证系统，匿名持久——同浏览器跨会话有效）
 * 写入：AI在【裁决】表后输出机器记账行，前端done后解析存档
 * 召回：请求前把历史判断entries传给API（historyLedger字段），后端注入+规则28强制对账
 */

export type LedgerEntry = {
  symbol: string; // 标的（AI记账行原样，如 "NVDA(英伟达)"）
  stance: string; // 多 / 空 / 观望
  keyLevel: string; // 关键位（入场/触发价）
  invalidation: string; // 失效条件（具体可观测）
  confidence: string; // 信心度（AI自报）
  date: string; // YYYY-MM-DD
  ts: number; // 存档时间戳（ms）
  // Schema V2（10/1 Phase1）：可选扩展字段——旧记账行照常parse
  timeBoxDays?: number; // 时间盒天数：到期强制结算
  envTags?: string; // 环境标签（财报周/高波动等）
  execPlan?: string; // 执行层计划
};

const LEDGER_KEY = "fx_judgment_ledger_v1";
const MARKER = "【判断记账】";
const LEDGER_LINE_RE = /【判断记账】([^\n]+)/;
const MAX_ENTRIES = 200;
const KEEP_DAYS = 90;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadLedger(): LedgerEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? pruneLedger(arr) : [];
  } catch {
    return [];
  }
}

export function saveEntry(entry: LedgerEntry): void {
  if (!isBrowser()) return;
  try {
    const next = pruneLedger([...loadLedger(), entry]);
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
  } catch {
    // 存储满/隐私模式：记账失败静默，不影响对话主流程
  }
}

/** 10/2账本条目管理：单条删除（按时间戳）——误记/串数据条目不再只能整库清空 */
export function removeEntry(ts: number): void {
  if (!isBrowser()) return;
  try {
    const next = loadLedger().filter((e) => e.ts !== ts);
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
  } catch {
    // 静默
  }
}

/** 从AI全文提取记账行（【判断记账】标的=x | 立场=y | 关键位=z | 失效=w | 信心度=n% [| 时限=N日 | 环境=… | 执行=…]），失败返回null */
export function parseLedgerLine(text: string): LedgerEntry | null {
  const m = text.match(LEDGER_LINE_RE);
  if (!m) return null;
  const kv: Record<string, string> = {};
  // 9/13全角兼容：AI输出"｜"（全角管道）时split("|")静默漏字段→漏记账
  const parts = m[1].split(/[｜|]/);
  for (let i = 0; i < parts.length; i++) {
    const idx = parts[i].indexOf("=");
    if (idx > 0) {
      kv[parts[i].slice(0, idx).trim()] = parts[i].slice(idx + 1).trim();
    }
  }
  if (!kv["标的"] || !kv["立场"]) return null;
  // Schema V2可选字段：时限=NN日（兼容"5日"/"20日"）；环境；执行
  const tbRaw = kv["时限"] ?? kv["时间盒"];
  const tbDays = tbRaw ? parseInt((tbRaw.match(/\d+/) ?? [])[0] ?? "", 10) : NaN;
  return {
    symbol: kv["标的"],
    stance: kv["立场"],
    keyLevel: kv["关键位"] || "",
    invalidation: kv["失效"] || "",
    confidence: kv["信心度"] || "",
    date: new Date().toISOString().slice(0, 10),
    ts: Date.now(),
    ...(Number.isFinite(tbDays) && tbDays > 0 ? { timeBoxDays: tbDays } : {}),
    ...(kv["环境"] ? { envTags: kv["环境"] } : {}),
    ...(kv["执行"] ? { execPlan: kv["执行"] } : {}),
  };
}

/** 渲染/存档前剥离机器记账行（用户不看原始字段行） */
export function stripLedgerLines(text: string): string {
  return text.replace(new RegExp(MARKER + "[^\\n]*(\\n|$)", "g"), "").replace(/\n{3,}/g, "\n\n");
}

/**
 * 写入侧字段污染校验（10/2 S3：VIX条目混入TSLA关键位/PE数字——AI自由生成记账行不可信，两次复现=系统性缺陷）。
 * 三层闸：
 *  A 字段归属：keyLevel纯数字若在本回答中处于PE/市盈率/百分比等非价格语境→不是价格→降级引用式（宁缺勿错）
 *  B 异标的污染：keyLevel/invalidation里出现【其他标的代码】（注入徽标含但entry.symbol不是）→字段被串→降级引用式
 *  C 回读自检：saveEntry后loadLedger()最后一条字段必须与刚写入一致（localStorage序列化事故拦截）
 * 校验只降级可疑字段为引用式，不丢整条（立场/标的归属可信）。
 */
export function validateEntry(
  entry: LedgerEntry,
  answer: string,
  injectedPhrases: string[],
): LedgerEntry {
  let e = { ...entry };
  const sym = e.symbol.replace(/\(.*\)/, "").trim().toUpperCase();
  const baseSym = sym.split(/[^A-Z]/)[0] || sym;

  // 收集"其他标的代码"：注入徽标（如"NVDA行情"）里出现但不是本条标的
  const otherCodes = new Set<string>();
  for (const p of injectedPhrases || []) {
    const m = p.toUpperCase().match(/[A-Z]{2,6}/);
    if (m && !m[0].startsWith(baseSym) && !baseSym.startsWith(m[0])) otherCodes.add(m[0]);
  }

  // A 关键位=纯数字时的语境校验：数字在回答中若紧跟非价格语境词→污染
  const klNum = e.keyLevel.match(/^(\d{2,6}(?:\.\d{1,2})?)$/);
  if (klNum) {
    const num = klNum[1];
    const re = new RegExp(`[^\\n]{0,30}${num.replace(".", "\\.")}[^\\n]{0,30}`);
    const ctx = answer.match(re);
    if (ctx && /PE\b|市盈率|PB\b|市净率|EPS|增速|毛利率|净利率|收益率|回报率|倍\b|概率|信心度/.test(ctx[0]) && !/现价|支撑|压力|阻力|止损|止盈|目标价|入场|关键位|加仓点|买点|突破/.test(ctx[0])) {
      e.keyLevel = "见裁决行动分支"; // 非价格数字冒充价格
    }
  }

  // B 异标的代码出现在字段文本里→串数据
  if (otherCodes.size > 0) {
    for (const field of ["keyLevel", "invalidation"] as const) {
      const v = e[field];
      if (!v || v.startsWith("见")) continue;
      for (const code of Array.from(otherCodes)) {
        if (new RegExp(`\\b${code}\\b`).test(v)) {
          e[field] = field === "keyLevel" ? "见裁决行动分支" : "见裁决行失效条件";
          break;
        }
      }
    }
  }

  // D 语义污染门（10/3真机实锤：VIX条目的失效条件字段装了对账叙述"失效未触发，维持原立场…信心度维持70%"——
  // 特征=含对账词汇或超长叙述句，不是"方向词+价位/事件"格式）→ 尝试从正文重提真失效条件，提不出则降级引用式
  const NARRATIVE_RE = /失效未触发|维持原立场|维持.{0,4}立场|信心度维持|新证据|对账|核验状态|系统能验|维持现有判断|立场未变/;
  const inv = e.invalidation || "";
  if (NARRATIVE_RE.test(inv) || inv.length > 60) {
    // 从正文重提：优先"失效预注册：/失效条件："标记行，其次"跌破/站上/突破+价位"句式
    const re2 = text.match(/(?:失效预注册|失效条件|证伪信号|翻转信号)[^：:\n]*[：:]\s*([^\n]{6,60})/);
    const re3 = re2 ? null : text.match(/([^\n]{0,20}(?:跌破|失守|站上|突破|收于)[^\n]{0,4}\$?\d{2,6}(?:\.\d{1,2})?[^\n]{0,30})/);
    const recovered = (re2?.[1] ?? re3?.[1] ?? "").replace(/\*\*/g, "").trim();
    e.invalidation = recovered.length >= 6 && recovered.length <= 60 ? recovered : "见裁决行失效条件";
  }

  // 失效字段混入markdown星号/正文污染清洗（S3现象：失效字段带"**"与整句正文）
  e.invalidation = e.invalidation.replace(/\*\*/g, "").trim();
  if (e.invalidation.length > 60) e.invalidation = "见裁决行失效条件";
  if (e.keyLevel.length > 60) e.keyLevel = "见裁决行动分支";

  return e;
}

/** C 回读自检：写入后立即读回核对（localStorage序列化/覆写事故拦截），返回false=写入未生效 */
export function verifySaved(entry: LedgerEntry): boolean {
  const all = loadLedger();
  const last = all[all.length - 1];
  return !!last && last.ts === entry.ts && last.symbol === entry.symbol;
}

/** 90天过期+容量上限 */
export function pruneLedger(entries: LedgerEntry[]): LedgerEntry[] {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  const fresh = entries.filter((e) => e && typeof e.ts === "number" && e.ts >= cutoff);
  return fresh.slice(-MAX_ENTRIES);
}

/** 清空账本（账本UI的清空按钮） */
export function clearLedger(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(LEDGER_KEY);
  } catch {
    // localStorage满/禁用：静默（账本是增强不是依赖）
  }
}

/**
 * 裁决行兜底提取（10/1六轮检测P2-11：记账行产出不稳定——规则27靠AI自觉，
 * AAPL标准档实测漏记账行）。parseLedgerLine失败时从【裁决】行结构化提取：
 * 标的=注入行情锚点行（优先）→用户文本大写代码；立场=方向词推断；
 * 关键位=裁决行首个价格样式数字；失效=失效/证伪段首个具体表述。
 * 提取不到标的或立场→null（宁缺勿错，不写垃圾行）。
 */
export function parseRulingFallback(text: string, injected: string[], userText: string): LedgerEntry | null {
  const ruling = text.match(/【裁决】([^\n]+)/);
  if (!ruling) return null;
  const seg = ruling[1];

  // 标的：注入行情锚点行（如"实时行情1只：NVDA 英伟达 $228.38..."或"NVIDIA CORP"）优先
  let symbol = "";
  const injectedText = (injected || []).join(" ");
  const m = injectedText.match(/\b([A-Z]{2,6})\b\s*[\|·]/) || injectedText.match(/\b([A-Z]{2,6})(?:\(英伟达\)| CORP| INC| ETF)\b/);
  if (m) symbol = m[1];
  if (!symbol) {
    const injectedCode = injectedText.match(/(?:行情|现价|最新价)[^\n]{0,40}?([A-Z]{2,6})/);
    if (injectedCode) symbol = injectedCode[1];
  }
  // 用户文本大写代码兜底（排除常见噪声词）
  if (!symbol) {
    const NOISE = new Set(["PE","PB","ROE","EPS","ETF","CEO","VIX","FED","CPI","AI","ML","API","USD","MA","MA20","MA60","MA200"]);
    const codes = userText.match(/\$?([A-Z]{2,6})\b/g) || [];
    for (const c of codes) {
      const clean = c.replace(/\$/g, "");
      if (!NOISE.has(clean) && clean.length >= 2) { symbol = clean; break; }
    }
  }
  if (!symbol) return null;

  // 立场：裁决行动分支方向词推断
  let stance = "观望";
  if (/回踩买入|放量突破买入|做多|加仓|看多|建仓|维持现有仓位|首笔/.test(seg)) stance = "多";
  else if (/卖出|做空|减仓|看空|回避|清仓|不建仓|观望不追/.test(seg)) stance = "空";

  // 关键位：裁决行首个价格样式数字（2-6位，可带小数）
  const lv = seg.match(/\$?(\d{2,6}(?:\.\d{1,2})?)/);
  const keyLevel = lv ? lv[1] : "";

  // 失效条件：失效/证伪/翻转信号段第一个具体表述
  const invMatch = text.match(/(?:失效预注册|失效条件|证伪信号|翻转信号|失效)[^：:\n]*[：:]\s*([^\n]{8,150})/);
  const invalidation = invMatch ? invMatch[1].trim() : "";

  // 信心度：全文首个"信心度N%"
  const conf = text.match(/信心度[=：:]?\s*(\d{1,3}%)/);

  return {
    symbol, // 10/1交叉验证X6修复：纯代码（"KO（兜底提取）"后缀会破坏规则28按symbol对账+结算代码提取——对账双链一致性优先）
    stance,
    keyLevel: keyLevel || "见裁决行动分支",
    invalidation: invalidation || "见裁决行失效条件",
    confidence: conf ? conf[1] : "见裁决表述",
    date: new Date().toISOString().slice(0, 10),
    ts: Date.now(),
  };
}
