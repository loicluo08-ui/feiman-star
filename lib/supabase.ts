// Supabase服务端客户端（9/13底层建设P1）——REST直连零依赖（不引supabase-js，serverless冷启动更快）
// 只在服务端使用（service key特权），前端禁止import此文件
// 表：kb_dynamic / judgment_ledger / chat_logs / user_profile（建表SQL见2026-09-13会话）

const SUPABASE_URL = process.env.SUPABASE_URL || "";
// 兼容两代变量名：主站8/9配的是SERVICE_ROLE_KEY，新规范名SERVICE_KEY——取其一即可
// 防御清理：粘贴值可能混入中文标点（实测顿号U+3001致fetch ByteString错）
const cleanKey = (v: string) => v.replace(/[^\x20-\x7E]/g, "").trim();
const SUPABASE_KEY = cleanKey(
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export function supabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

export async function sbRest<T>(
  path: string,
  options: { method?: string; body?: unknown; prefer?: string } = {}
): Promise<T | null> {
  if (!supabaseConfigured()) return null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${SUPABASE_KEY}`,
    apikey: SUPABASE_KEY,
    "Content-Type": "application/json",
  };
  if (options.prefer) headers.Prefer = options.prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`supabase_${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

// ——— KB动态层 ———
export interface KbDynamicRow {
  id: string;
  type: string;
  keywords: string[];
  content: string;
  source: string;
  created: string;
  expires?: string | null;
  embedding?: string | null; // pgvector文本形态（语义检索用）
}

export async function upsertKbEntries(rows: KbDynamicRow[]): Promise<boolean> {
  if (rows.length === 0) return true;
  // 10/3 P0修复：PGRST102 "All object keys must match"——存量行expires/embedding为NULL，读回映射成
  // undefined后JSON.stringify丢弃键，与新行（有键）混批导致行键不齐→400。KB动态层因此28天静默停摆
  // （9/13实锤：快照停在9/13、洞察0条）。写入前统一键集（可空字段显式补null）。
  const norm = rows.map((r) => ({
    id: r.id,
    type: r.type,
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    content: r.content,
    source: r.source,
    created: r.created,
    expires: r.expires ?? null,
    embedding: r.embedding ?? null,
  }));
  // 返回值语义修正（与insertLedgerRows同款）：return=minimal时201空body→sbRest返回null，
  // 原实现`out!==null`把成功误报为false。语义=异常false，正常返回（含null）true。
  try {
    await sbRest("kb_dynamic?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: norm,
    });
    return true;
  } catch {
    return false;
  }
}

export async function readKbEntries(limit = 200): Promise<KbDynamicRow[] | null> {
  // 10/1 P0修复：排除access_log（对方session把访问日志零DDL写进本表）——
  // 日志含用户IP/geo，混进语义检索=隐私注入AI回答+挤占知识配额。读路径统一排除，写路径互不影响。
  const out = await sbRest<KbDynamicRow[]>(
    // 10/2漏洞审计P0修复：username_claim（用户名字+城市PII）与ip_block（拉黑记录）混进语义检索
    // =PII注入AI回答+挤占知识配额——与access_log同一性质，读路径统一排除
    `kb_dynamic?select=id,type,keywords,content,source,created,expires&type=neq.access_log&type=neq.username_claim&type=neq.ip_block&type=neq.geo_cache&order=created.desc&limit=${limit}`
  );
  return out;
}

// ——— 判断账本（服务端化：localStorage退役为缓存）———
export interface LedgerRow {
  symbol: string;
  stance: string;
  key_level?: string;
  invalidation?: string;
  confidence?: string;
  date: string;
  ts?: string;
  // Schema V2（10/1 Phase1）——全列可空，004 SQL未执行时为undefined
  time_box?: number | null; // 时间盒天数：短线5/波段20/长线60，到期强制结算
  env_tags?: string | null; // 环境标签逗号串：财报周/高波动等
  failure_strictness?: string | null; // strict=可机械核验 | narrative=纯叙事（不入对错率）
  exec_plan?: string | null; // 执行层计划
  corrects?: string | null; // 修正轨迹：前置判断键 symbol|date
}

export async function insertLedgerRows(rows: LedgerRow[]): Promise<boolean> {
  if (rows.length === 0) return true;
  // 10/1修复：return=minimal时Supabase返回201+空body，sbRest解析为null——null≠失败（写入实际成功）。
  // 原实现`out !== null`把成功写入误报为false（judgment-cloud线上502但数据落库实锤）。
  // 语义修正：异常=失败（false），正常返回（含null）=成功。
  try {
    await sbRest("judgment_ledger", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: rows,
    });
    return true;
  } catch {
    return false;
  }
}

export async function readLedgerBySymbol(symbol: string, limit = 5): Promise<LedgerRow[] | null> {
  const encoded = encodeURIComponent(symbol);
  return sbRest<LedgerRow[]>(
    `judgment_ledger?select=symbol,stance,key_level,invalidation,confidence,date,ts&symbol=eq.${encoded}&order=ts.desc&limit=${limit}`
  );
}

// 9/18能力工程：账本全量读取（公开账本页+自动结算cron共用）
// 10/1 schema V2：select=*（列名显式清单会在004 SQL未执行时报400；*对列变化向前兼容）
export async function readAllLedger(limit = 500): Promise<LedgerRow[] | null> {
  return sbRest<LedgerRow[]>(
    `judgment_ledger?select=*&order=ts.desc&limit=${limit}`
  );
}

// P2③：向量化写入（pgvector列——REST写入用字符串格式'[0.1,...]'）
export async function updateKbEmbedding(id: string, vector: number[]): Promise<boolean> {
  if (!supabaseConfigured() || vector.length === 0) return false;
  const out = await sbRest(`kb_dynamic?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { embedding: `[${vector.join(",")}]` },
  });
  return out !== null;
}

// P2③语义检索：客户端余弦相似度（免DDL——条目<200条性能毫秒级）
export async function matchKbSemantic(
  queryVector: number[],
  matchCount = 6,
  maxDistance = 0.75
): Promise<KbDynamicRow[] | null> {
  if (!supabaseConfigured() || queryVector.length === 0) return null;
  try {
    // 10/3 P1修复：必须带type过滤——access_log每天+56条洪流，limit=200无过滤时
    // 三天后老知识条目将被挤出窗口，语义检索慢性死亡（见output/ops_log/kb_semantic_audit_1003.md）
    const rows = await sbRest<Array<KbDynamicRow & { embedding: string | null }>>(
      "kb_dynamic?select=id,type,keywords,content,source,created,expires,embedding&type=neq.access_log&type=neq.username_claim&type=neq.ip_block&type=neq.geo_cache&order=created.desc&limit=200"
    );
    if (!rows) return null;
    const today = new Date().toISOString().slice(0, 10);
    const scored: Array<{ row: KbDynamicRow; dist: number }> = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.embedding || (r.expires && r.expires < today)) continue;
      let vec: number[] = [];
      try {
        vec = typeof r.embedding === "string" ? (JSON.parse(r.embedding) as number[]) : (r.embedding as unknown as number[]);
      } catch {
        continue;
      }
      if (!Array.isArray(vec) || vec.length !== queryVector.length) continue;
      let dot = 0, na = 0, nb = 0;
      for (let j = 0; j < vec.length; j++) {
        dot += vec[j] * queryVector[j];
        na += vec[j] * vec[j];
        nb += queryVector[j] * queryVector[j];
      }
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      if (denom === 0) continue;
      const dist = 1 - dot / denom;
      if (dist < maxDistance) scored.push({ row: r, dist });
    }
    scored.sort((a, b) => a.dist - b.dist);
    return scored.slice(0, matchCount).map((x) => x.row);
  } catch {
    return null;
  }
}

// P2②用户画像v0：判断账本聚合——关注标的池+各标的最近立场（"认识用户"的地基数据）
export interface ProfileFocus {
  symbol: string;
  stance: string;
  lastDate: string;
  count: number;
}

export async function getFocusPool(): Promise<ProfileFocus[] | null> {
  const rows = await sbRest<Array<{ symbol: string; stance: string; date: string }>>(
    "judgment_ledger?select=symbol,stance,date&order=ts.desc&limit=200"
  );
  if (!rows) return null;
  const map = new Map<string, ProfileFocus>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const prev = map.get(r.symbol);
    if (prev) {
      prev.count += 1;
      if (r.date > prev.lastDate) prev.lastDate = r.date;
    } else {
      map.set(r.symbol, { symbol: r.symbol, stance: r.stance, lastDate: r.date, count: 1 });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 12);
}

// ——— 对话日志（评测/反思原料）———
export async function insertChatLog(row: {
  question: string;
  answer?: string;
  tools_used?: string[];
  style?: string;
  ip?: string | null;
}): Promise<boolean> {
  try {
    await sbRest("chat_logs", {
      method: "POST",
      prefer: "return=minimal",
      body: row,
    });
    return true;
  } catch {
    // 降级：ip列未建（005未执行）时带ip写入42703失败——去ip重试保对话日志不丢
    if (row.ip !== undefined) {
      try {
        const { ip: _drop, ...rest } = row;
        await sbRest("chat_logs", { method: "POST", prefer: "return=minimal", body: rest });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

// ——— 用户画像KV———
export async function setProfile(key: string, value: unknown): Promise<boolean> {
  const out = await sbRest("user_profile?on_conflict=key", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { key, value: value as object, updated: new Date().toISOString() },
  });
  return out !== null;
}

export async function getProfile<T>(key: string): Promise<T | null> {
  const out = await sbRest<Array<{ key: string; value: T }>>(
    `user_profile?select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`
  );
  return out && out.length > 0 ? out[0].value : null;
}
