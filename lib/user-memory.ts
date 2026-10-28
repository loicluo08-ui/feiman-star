// 用户长期记忆（10/28逸翔令"开通记忆功能，如同agent模式一样参考agentmore"）
// AgentMore模式映射：read_memory→chat注入 / edit_memory→对话后提取 / 用户全透明可控
// 存储：user_profile表零DDL复用（key=mem:{identity}，value.items数组）——本表自9/13建表以来空置
// 原则（提取prompt同款红线）：只记用户明确陈述的事实（持仓/关注标的/经验背景/明确偏好），
//   禁止推断、禁止敏感个人信息（住址/证件/家庭/联系方式）；游客（无fx_username）不做记忆
import { sbRest, supabaseConfigured } from "@/lib/supabase";

export interface MemoryItem {
  text: string;   // 记忆正文（一句完整事实，≤120字）
  created: string; // ISO日期
  src: string;    // 来源问题摘要（≤30字，供用户对账"哪句话被记了"）
  kind?: MemoryKind; // V2记忆类型（旧条目无此字段=按fact处理）
  tags?: string[];   // V2语义标签（标的symbol/主题词）——注入路由用（AgentMore路由索引映射）
}

// V2四类记忆（AgentMore深度映射）：fact=明确事实（V1原有）/profile=用户画像（风险偏好·期限·经验，恒注入）
// /correction=用户纠偏（AI曾被纠正什么，恒注入——同型不再错）/goal=目标与进度（"我在学期权"，对账进度）
export type MemoryKind = "fact" | "profile" | "correction" | "goal";

const MEM_CAP = 50; // 单用户记忆上限（超出=最旧的被淘汰）

/** fx_username cookie解码（middleware同款逻辑内联——循环decode到白名单通过，兼容Next自动编码/双层残留） */
export function decodeFxUsername(rawCookie: string | undefined | null): string {
  const USERNAME_RE = /^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,12}$/;
  let raw = rawCookie || "";
  for (let i = 0; i < 2 && !USERNAME_RE.test(raw); i++) {
    try {
      const d = decodeURIComponent(raw);
      if (d === raw) break;
      raw = d;
    } catch {
      break;
    }
  }
  return USERNAME_RE.test(raw) ? raw : "";
}

function memKey(identity: string): string {
  return `mem:${identity}`;
}

function normalizeIdentity(raw: string): string {
  return raw.trim().slice(0, 64);
}

/** 读某用户的全部记忆（注入用）。失败/未配置=返回空数组（增强不依赖） */
export async function readUserMemory(identity: string): Promise<MemoryItem[]> {
  if (!supabaseConfigured() || !identity) return [];
  try {
    const rows = await sbRest<Array<{ value: { items?: MemoryItem[] } | null }>>(
      `user_profile?key=eq.${encodeURIComponent(memKey(identity))}&select=value&limit=1`
    );
    const items = rows?.[0]?.value?.items;
    return Array.isArray(items) ? items.filter((it) => it && typeof it.text === "string") : [];
  } catch {
    return [];
  }
}

/** 合并写入：相似去重（归一化后前12字全等或互含）→cap淘汰最旧。返回写入条数 */
export async function appendUserMemory(identity: string, newItems: MemoryItem[]): Promise<number> {
  if (!supabaseConfigured() || !identity || newItems.length === 0) return 0;
  const key = memKey(normalizeIdentity(identity));
  const norm = (t: string) => t.replace(/[\s，。！？、,.!?]/g, "").slice(0, 12);
  const existing = await readUserMemory(identity);
  const merged: MemoryItem[] = [...existing];
  let added = 0;
  for (const item of newItems) {
    const text = String(item.text || "").trim().slice(0, 120);
    if (!text) continue;
    const n = norm(text);
    const dup = merged.some((m) => {
      const nm = norm(m.text);
      return nm === n || (n.length >= 12 && nm.startsWith(n)) || (nm.length >= 12 && n.startsWith(nm));
    });
    if (dup) continue;
    merged.push({
      text,
      created: item.created || new Date().toISOString().slice(0, 10),
      src: String(item.src || "").slice(0, 30),
      kind: item.kind,
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 3) : [],
    });
    added += 1;
  }
  if (added === 0) return 0;
  merged.sort((a, b) => (a.created < b.created ? -1 : 1)); // 最旧在前
  while (merged.length > MEM_CAP) merged.shift();
  try {
    // key列是PRIMARY KEY（10/28管理API实证）——POST+merge-duplicates=干净upsert，一行搞定新首条与追加
    await sbRest("user_profile", {
      method: "POST",
      body: { key, value: { items: merged }, updated: new Date().toISOString() },
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    return added;
  } catch {
    return 0;
  }
}

/** 删除指定下标的记忆（用户主权）。返回剩余条数；-1=存储不可用 */
export async function deleteUserMemoryAt(identity: string, index: number): Promise<number> {
  if (!supabaseConfigured() || !identity) return -1;
  const existing = await readUserMemory(identity);
  if (index < 0 || index >= existing.length) return existing.length;
  existing.splice(index, 1);
  const key = memKey(normalizeIdentity(identity));
  try {
    await sbRest(`user_profile?key=eq.${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: { value: { items: existing }, updated: new Date().toISOString() },
      prefer: "return=minimal",
    });
    return existing.length;
  } catch {
    return -1;
  }
}

/**
 * 记忆提取（AgentMore的edit_memory映射）：把最近一轮对话交给免费池模型提炼"值得长期记住的用户事实"。
 * 红线进prompt：只记明确陈述的事实；禁推断；禁敏感个人信息；无值得记的=空数组。
 * task=extract走免费池（成本0）；失败=空数组静默（记忆增强永不阻塞对话）
 */
export async function extractMemories(question: string, answer: string): Promise<MemoryItem[]> {
  if (!supabaseConfigured()) return [];
  const q = String(question || "").slice(0, 1500);
  const a = String(answer || "").slice(0, 1500);
  if (!q) return [];
  const { gatewayChat } = await import("@/lib/model-gateway");
  // 10/28 V2深度映射：四类记忆（fact/profile/correction/goal）+tags语义标签（注入路由用）
  const sys = [
    "你从一段投资对话中提取「值得长期记住的用户信息」。只提取用户原话明确表达的，分四类：",
    "①fact 明确事实：持仓（标的/数量/成本）、长期关注的标的、投资经验/背景、明确的偏好或约束（如只做美股、不用杠杆）",
    "②profile 用户画像：风险偏好（保守/平衡/激进的原话表述）、投资期限/风格（短线/波段/长线）、熟悉度（新手/有经验）",
    "③correction 用户纠偏：用户明确纠正了AI的理解/说法（'我说的不是这个意思，是XX'）——逐字记用户纠正后的正确含义",
    "④goal 目标与计划：用户说出的目标/学习计划（'我在学期权''这个月建仓'）",
    "铁律：只记用户原话明确说出的信息，禁止任何推断和补全；住址/证件/家庭/联系方式/年龄等敏感个人信息绝对不记；",
    "泛泛的提问（'苹果怎么样'）与AI单方面的分析结论都不是用户信息，不记。没有值得记的就输出空数组。",
    '给每条记忆打tags（大写标的代码如AAPL/主题词如期权、风控，0-3个）。',
    '输出纯JSON：{"items":[{"text":"一句完整事实≤80字","kind":"fact|profile|correction|goal","tags":["AAPL"],"src":"来源问题≤20字"}]}',
  ].join("\n");
  try {
    const r = await gatewayChat(
      [
        { role: "system", content: sys },
        { role: "user", content: `【用户问】${q}\n【助手答（节选）】${a}\n\n提取用户信息：` },
      ],
      { task: "extract", json: true, maxTokens: 600, timeout: 25_000 }
    );
    if (!r.text) return [];
    const parsed = JSON.parse(r.text.replace(/```json|```/g, "").trim()) as {
      items?: Array<{ text?: string; src?: string; kind?: string; tags?: unknown }>;
    };
    const now = new Date().toISOString().slice(0, 10);
    const KINDS = new Set(["fact", "profile", "correction", "goal"]);
    return (parsed.items || [])
      .filter((it) => it && typeof it.text === "string" && it.text.trim().length >= 4)
      .slice(0, 5)
      .map((it) => ({
        text: it.text!.trim(),
        created: now,
        src: String(it.src || q.slice(0, 20)).slice(0, 30),
        kind: (KINDS.has(String(it.kind)) ? it.kind : "fact") as MemoryItem["kind"],
        tags: Array.isArray(it.tags)
          ? it.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim().toUpperCase().slice(0, 12)).slice(0, 3)
          : [],
      }));
  } catch {
    return [];
  }
}

/**
 * 组装chat注入块（V2路由版——AgentMore"路由索引禁通读"映射）：
 * profile/correction恒注入（画像定调+纠偏防重复犯错，都短）；fact/goal按本轮问题tags相关召回；
 * 无tags的相关性判定退化=全文包含匹配。相关不足时fact取最新3条兜底（新用户冷启动）。
 */
export function buildMemoryBlock(items: MemoryItem[], questionHint = ""): string {
  if (items.length === 0) return "";
  const KIND_LABEL: Record<string, string> = { fact: "", profile: "画像", correction: "纠偏", goal: "目标" };
  const hitTokens = questionHint.toUpperCase().replace(/[^A-Z0-9\u4e00-\u9fa5]+/g, " ").split(/\s+/).filter(Boolean);
  const relevant = (it: MemoryItem): boolean => {
    if (!it.tags || it.tags.length === 0) return false;
    return it.tags.some((t) => hitTokens.some((tok) => tok.includes(t) || t.includes(tok)));
  };
  const always = items.filter((it) => it.kind === "profile" || it.kind === "correction");
  const routed = items.filter((it) => (it.kind === "fact" || it.kind === "goal" || !it.kind) && relevant(it));
  const fallback = items
    .filter((it) => (it.kind === "fact" || it.kind === "goal" || !it.kind))
    .slice(-3); // 最新3条兜底
  const pickedFacts = routed.length > 0 ? routed : fallback;
  const fmt = (it: MemoryItem): string => {
    const label = KIND_LABEL[it.kind || "fact"] || "";
    const tags = it.tags && it.tags.length > 0 ? `[${it.tags.join("/")}]` : "";
    return `${label ? `【${label}】` : ""}${it.text}${tags}（${it.created}）`;
  };
  const lines: string[] = [];
  for (const it of always) lines.push(fmt(it));
  for (const it of pickedFacts) lines.push(fmt(it));
  if (lines.length === 0) return "";
  return [
    "",
    "【用户既往记忆】（来自该用户历史对话的自动提取，仅供参考背景，可能过时——",
    "不得当作实时事实引用，与本题无关的一条不提，与注入数据冲突时以实时数据为准；",
    "【纠偏】条目=用户曾纠正AI的地方，同型情境必须遵循用户纠正后的口径）：",
    ...lines,
  ].join("\n");
}
