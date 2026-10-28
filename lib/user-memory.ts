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
}

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
    merged.push({ text, created: item.created || new Date().toISOString().slice(0, 10), src: String(item.src || "").slice(0, 30) });
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
  const sys = [
    "你从一段投资对话中提取「值得长期记住的用户事实」。只提取用户明确陈述的：",
    "①持仓（标的/数量/成本）②长期关注的标的 ③投资经验/背景（如从业年限、使用工具）④明确的偏好或约束（如只做美股、不用杠杆）。",
    "铁律：只记录用户原话明确说出的信息，禁止任何推断和补全；住址/证件/家庭/联系方式/年龄等敏感个人信息绝对不记；",
    "泛泛的提问（'苹果怎么样'）不是事实，不记。没有值得记的就输出空数组。",
    '输出纯JSON：{"items":[{"text":"一句完整事实≤80字","src":"来源问题≤20字"}]}',
  ].join("\n");
  try {
    const r = await gatewayChat(
      [
        { role: "system", content: sys },
        { role: "user", content: `【用户问】${q}\n【助手答（节选）】${a}\n\n提取用户事实：` },
      ],
      { task: "extract", json: true, maxTokens: 500, timeout: 25_000 }
    );
    if (!r.text) return [];
    const parsed = JSON.parse(r.text.replace(/```json|```/g, "").trim()) as { items?: Array<{ text?: string; src?: string }> };
    const now = new Date().toISOString().slice(0, 10);
    return (parsed.items || [])
      .filter((it) => it && typeof it.text === "string" && it.text.trim().length >= 4)
      .slice(0, 5)
      .map((it) => ({ text: it.text!.trim(), created: now, src: String(it.src || q.slice(0, 20)).slice(0, 30) }));
  } catch {
    return [];
  }
}

/** 组装chat注入块（systemPrompt用）。空记忆=空串 */
export function buildMemoryBlock(items: MemoryItem[]): string {
  if (items.length === 0) return "";
  const lines = items.slice(0, 10).map((it, i) => `${i + 1}. ${it.text}（${it.created}）`);
  return [
    "",
    "【用户既往记忆】（来自该用户历史对话的自动提取，仅供参考背景，可能过时——",
    "不得当作实时事实引用，与本题无关的一条不提，与注入数据冲突时以实时数据为准）：",
    ...lines,
  ].join("\n");
}
