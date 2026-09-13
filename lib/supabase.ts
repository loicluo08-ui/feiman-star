// Supabase服务端客户端（9/13底层建设P1）——REST直连零依赖（不引supabase-js，serverless冷启动更快）
// 只在服务端使用（service key特权），前端禁止import此文件
// 表：kb_dynamic / judgment_ledger / chat_logs / user_profile（建表SQL见2026-09-13会话）

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

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

export async function readKbEntries(): Promise<KbDynamicRow[] | null> {
  const out = await sbRest<KbDynamicRow[]>(
    "kb_dynamic?select=id,type,keywords,content,source,created,expires&order=created.desc&limit=200"
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
