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
  // 10/3 P1：洞察内容去重——同日多轮生长提炼同一批快讯会产出近似洞察（feed换血慢时更甚），
  // 按content前30字判重，与库存量或本批内重复的跳过，防低价值堆积挤占语义检索配额
  const seenInsight = new Set(
    kept.filter((e) => e.type === "insight").map((e) => e.content.slice(0, 30))
  );
  const dedupedFresh = fresh.filter((f) => {
    if (f.type !== "insight") return true;
    const k = f.content.slice(0, 30);
    if (seenInsight.has(k)) return false;
    seenInsight.add(k);
    return true;
  });
  const merged = kept
    .filter((e) => e.type !== "data_snapshot" || !freshKeys.has(e.keywords.join("|")))
    .concat(dedupedFresh);
  return { merged, added: dedupedFresh.length };
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

// ——— 路2：动态层真生长（10/1知识库大整改第一步）———
// 病灶：此前kb-grow只采行情快照，"知识沉淀"没有知识。此函数把当日快讯提炼成投资洞察条目入动态库，
// 让chat的selectDynamicKB语义检索能召回"最近发生的事实+影响方向+失效条件"——知识库真的自己长。

export interface GrowInsightResult {
  insights: DynamicEntry[];
  flashCount: number;
  aiOk: boolean;
  error?: string;
}

/**
 * 当日快讯 → AI提炼投资洞察 → DynamicEntry[]
 * 质量闸：每条必须带具体数字/时间+影响方向+3-5个检索关键词；7天时效过期自动失效（KB失效总则对齐）；
 * AI失败/解析失败返回空数组不阻塞行情快照主流程（快照与洞察是两个独立管道）。
 */
export async function growInsights(): Promise<GrowInsightResult> {
  try {
    const { getFlashFeed } = await import("./flash-source");
    const feed = await getFlashFeed();
    const items = (feed.items ?? []).slice(0, 40);
    if (items.length === 0) return { insights: [], flashCount: 0, aiOk: false, error: "no_flash" };

    const compact = items.map((i) => ({
      t: i.time_str,
      title: i.title,
      text: (i.content_text || i.title).slice(0, 160),
      imp: i.is_important,
    }));
    const prompt = `以下是今日市场快讯（JSON数组）。提炼3-5条对投资判断有实际价值的洞察。
要求：
1. 每条=事实性洞察：具体事件（带数字与时间）+对哪类资产的影响方向，禁止空话套话
2. 只提与资产价格判断相关的（宏观/利率/行业/个股事件），跳过纯宣传性内容
3. content必须80字内且含至少一个具体数字或日期——没有可核验锚的条目不要
4. 输出纯JSON数组（不要markdown围栏）：[{"keywords":["关键词3-5个"],"content":"洞察正文","direction":"利多/利空/中性 + 影响对象"}]

快讯：${JSON.stringify(compact)}`;

    const { callAI } = await import("./ai");
    // 统一网关（10/1架构收敛）：callAI+task=extract走免费池降级链（GLM→火山→硅基→OR→dashscope→Groq→DeepSeek兜底）
    // 敏感边界：快讯为公开信息，走免费通道合规
    const resp = await callAI([{ role: "user", content: prompt }], { task: "extract", max_tokens: 1_200, timeout: 45_000 });
    if (!resp) return { insights: [], flashCount: items.length, aiOk: false, error: "ai_null" };
    return parseInsights(resp, items.length, feed.source);
  } catch (e) {
    return { insights: [], flashCount: 0, aiOk: false, error: e instanceof Error ? e.message.slice(0, 100) : "unknown" };
  }
}

/** 洞察解析+入库映射（GLM/DeepSeek共用）——容错JSON截取，缺字段条目丢弃（宁缺毋编） */
function parseInsights(resp: string, flashCount: number, feedSource: string): GrowInsightResult {
  const m = resp.match(/\[[\s\S]*\]/);
  if (!m) return { insights: [], flashCount, aiOk: true, error: "no_json" };
  const parsed = JSON.parse(m[0]) as Array<{ keywords?: string[]; content?: string; direction?: string }>;
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().toISOString().slice(11, 13);
  const expire = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const insights: DynamicEntry[] = [];
  parsed.forEach((p, i) => {
    if (!p.content || !p.keywords || p.keywords.length === 0) return;
    insights.push({
      // 10/3 P1：id带小时片——原`insight_${today}_${i}`在同日多轮生长时撞id，
      // route层Map按id去重导致后轮覆盖前轮（一天最多存活最后5条）
      id: `insight_${today}_${hour}_${i}`,
      type: "insight",
      keywords: [...p.keywords.slice(0, 5), today, "洞察"],
      content: `${p.content}（方向：${p.direction ?? "未标注"}；来源：${feedSource}${today}快讯提炼）`,
      source: "kb-grow-insights",
      created: today,
      expires: expire,
    });
  });
  return { insights, flashCount, aiOk: true };
}
