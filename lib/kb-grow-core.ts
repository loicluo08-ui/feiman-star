// KB动态层核心逻辑（9/13底层建设P0）——采集→条目生成→合并去重→GitHub持久化
// 供两处调用：/api/invest/cron-kb-grow（Vercel Cron自跑）+ scripts/kb_grow.mjs（本地手动）
// 持久化走GitHub Contents API（serverless文件系统只读）——commit触发Vercel重部署，新知识自动加载
// 时序快照同步沉淀：data/snapshots/YYYY-MM-DD.json——历史数据底座（分位数/回测计算依赖）

const REPO = "loicluo08-ui/feiman-star";
const BRANCH = "main";
const KB_PATH = "data/kb_dynamic.json";

export interface DynamicEntry {
  id: string;
  type: "data_snapshot" | "insight" | "gap";
  keywords: string[];
  content: string;
  source: string;
  created: string;
  expires?: string;
}

// ——— 腾讯行情（latin1足够：价格字段纯ASCII）——
// 9/13实测字段：f[3]=现价 f[39]=PE(TTM) f[48]=52周高 f[49]=52周低（cat -n行号=f[N-1]，33/34是当日高低）
export async function fetchQuoteTencent(sym: string): Promise<{
  price: number; high52: number; low52: number; pe: number;
} | null> {
  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${sym}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const text = Buffer.from(buf).toString("latin1");
    const f = text.split("~");
    if (f.length < 50 || !parseFloat(f[3])) return null;
    return {
      price: parseFloat(f[3]),
      high52: parseFloat(f[48]),
      low52: parseFloat(f[49]),
      pe: parseFloat(f[39]),
    };
  } catch {
    return null;
  }
}

const SYMBOLS = [
  { tencent: "usNVDA", name: "英伟达", kw: ["英伟达", "nvda"] },
  { tencent: "usTSLA", name: "特斯拉", kw: ["特斯拉", "tsla"] },
  { tencent: "usAAPL", name: "苹果", kw: ["苹果", "aapl"] },
  { tencent: "usMSFT", name: "微软", kw: ["微软", "msft"] },
  { tencent: "usAMD", name: "AMD", kw: ["amd", "超微"] },
  { tencent: "usMU", name: "美光", kw: ["美光", "mu"] },
];

function pct(a: number, b: number): string {
  return b ? ((a - b) / b * 100).toFixed(1) : "n/a";
}

export async function collectSnapshots(): Promise<DynamicEntry[]> {
  const today = new Date().toISOString().slice(0, 10);
  const expire = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const fresh: DynamicEntry[] = [];
  for (const s of SYMBOLS) {
    const q = await fetchQuoteTencent(s.tencent);
    if (!q) continue;
    const drawdown = pct(q.price, q.high52);
    const pos52 = q.high52 > q.low52 ? ((q.price - q.low52) / (q.high52 - q.low52) * 100).toFixed(1) : "n/a";
    const peStr = q.pe && q.pe > 0 ? `PE(TTM) ${q.pe.toFixed(1)}，` : "";
    fresh.push({
      id: `snapshot_${s.tencent}_${today}`,
      type: "data_snapshot",
      keywords: s.kw,
      content: `${s.name}行情快照（${today}）：现价$${q.price.toFixed(2)}，${peStr}52周高$${q.high52.toFixed(2)}/低$${q.low52.toFixed(2)}，处52周区间${pos52}%位置，距高点回撤${drawdown}%。数据来源：腾讯行情${today}。`,
      source: "vercel_cron",
      created: today,
      expires: expire,
    });
  }
  return fresh;
}

export function mergeEntries(existing: DynamicEntry[], fresh: DynamicEntry[]): {
  merged: DynamicEntry[]; added: number;
} {
  const today = new Date().toISOString().slice(0, 10);
  const kept = existing.filter((e) => !e.expires || e.expires >= today);
  const freshKeys = new Set(fresh.map((f) => f.keywords.join("|")));
  const merged = kept
    .filter((e) => e.type !== "data_snapshot" || !freshKeys.has(e.keywords.join("|")))
    .concat(fresh);
  return { merged, added: fresh.length };
}

// ——— GitHub Contents API持久化（serverless可写层）———
function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

export async function readKBFromGitHub(token: string): Promise<{ entries: DynamicEntry[]; sha: string | null }> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${KB_PATH}?ref=${BRANCH}`, {
    headers: ghHeaders(token), cache: "no-store",
  });
  if (res.status === 404) return { entries: [], sha: null };
  if (!res.ok) throw new Error(`github_read_${res.status}`);
  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  return { entries: Array.isArray(content.entries) ? content.entries : [], sha: data.sha };
}

export async function writeKBToGitHub(
  token: string,
  entries: DynamicEntry[],
  sha: string | null
): Promise<{ ok: boolean; commitSha?: string }> {
  const body: Record<string, unknown> = {
    message: `chore: KB动态层每日自动采集（vercel cron）`,
    content: Buffer.from(JSON.stringify({ entries }, null, 1)).toString("base64"),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${KB_PATH}`, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`github_write_${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return { ok: true, commitSha: data?.commit?.sha };
}

// 时序快照沉淀（data/snapshots/——历史底座，分位数计算依赖）
export async function writeDailySnapshot(token: string, entries: DynamicEntry[]): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const path = `data/snapshots/${today}.json`;
  const readRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, {
    headers: ghHeaders(token), cache: "no-store",
  });
  if (readRes.ok) return; // 当日已存在，不覆盖
  const body = {
    message: `chore: 时序快照沉淀 ${today}`,
    content: Buffer.from(JSON.stringify({ date: today, entries }, null, 1)).toString("base64"),
    branch: BRANCH,
  };
  await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body),
  });
}
