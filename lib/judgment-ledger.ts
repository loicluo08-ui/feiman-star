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

/** 从AI全文提取记账行（【判断记账】标的=x | 立场=y | 关键位=z | 失效=w | 信心度=n%），失败返回null */
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
  return {
    symbol: kv["标的"],
    stance: kv["立场"],
    keyLevel: kv["关键位"] || "",
    invalidation: kv["失效"] || "",
    confidence: kv["信心度"] || "",
    date: new Date().toISOString().slice(0, 10),
    ts: Date.now(),
  };
}

/** 渲染/存档前剥离机器记账行（用户不看原始字段行） */
export function stripLedgerLines(text: string): string {
  return text.replace(new RegExp(MARKER + "[^\\n]*(\\n|$)", "g"), "").replace(/\n{3,}/g, "\n\n");
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
