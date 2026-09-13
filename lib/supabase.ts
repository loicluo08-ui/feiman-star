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

async function sbRest<T>(
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
}

export async function upsertKbEntries(rows: KbDynamicRow[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const out = await sbRest("kb_dynamic?on_conflict=id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: rows,
  });
  return out !== null;
}

export async function readKbEntries(limit = 200): Promise<KbDynamicRow[] | null> {
  const out = await sbRest<KbDynamicRow[]>(
    `kb_dynamic?select=id,type,keywords,content,source,created,expires&order=created.desc&limit=${limit}`
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
}

export async function insertLedgerRows(rows: LedgerRow[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const out = await sbRest("judgment_ledger", {
    method: "POST",
    prefer: "resolution=ignore-duplicates,return=minimal",
    body: rows,
  });
  return out !== null;
}

export async function readLedgerBySymbol(symbol: string, limit = 5): Promise<LedgerRow[] | null> {
  const encoded = encodeURIComponent(symbol);
  return sbRest<LedgerRow[]>(
    `judgment_ledger?select=symbol,stance,key_level,invalidation,confidence,date,ts&symbol=eq.${encoded}&order=ts.desc&limit=${limit}`
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
    const rows = await sbRest<Array<KbDynamicRow & { embedding: string | null }>>(
      "kb_dynamic?select=id,type,keywords,content,source,created,expires,embedding&order=created.desc&limit=200"
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
}): Promise<boolean> {
  const out = await sbRest("chat_logs", {
    method: "POST",
    prefer: "return=minimal",
    body: row,
  });
  return out !== null;
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
