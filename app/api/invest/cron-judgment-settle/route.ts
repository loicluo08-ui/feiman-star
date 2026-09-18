import { NextRequest, NextResponse } from "next/server";

/**
 * 判断账本自动结算（9/18能力工程P0——"每周结算"从人肉变心跳）
 *
 * 逻辑：读judgment_ledger未结算行 → 腾讯源取现价 → 失效条件机械核验
 *   （invalidation文本提方向词+数字：跌破类向下触发/突破类向上触发）
 *   → 结算结果写kb_dynamic（type=insight, content.kind=judgment_settle）
 *
 * 结算语义（判断能力工程的科学性所在）：
 *   invalidated = 失效条件触发，判断被证伪（公开记录，不藏错——错的可见性=可信度）
 *   confirmed   = 立场方向上的关键位未破（判断存活中，未到失效条件）
 *
 * 零DDL：结算结果复用kb_dynamic现有表（9/13四表），ledger原生结算字段迁移SQL
 * 见 sql/003_ledger_settle_columns.sql（可选升级，未执行时本路由照常工作）
 *
 * 鉴权：Authorization: Bearer ${CRON_SECRET} 或 ?token=${CRON_SECRET}（同cron-kb-grow）
 */
export const maxDuration = 60;

import { readAllLedger, readKbEntries, upsertKbEntries, type KbDynamicRow } from "@/lib/supabase";

function authOk(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("token") === secret;
}

// 方向词分类（与chat路由记账核验同源口径）
const TRIG_DOWN_RE = /跌破|失守|下破|低于|收于.*之下/;
const TRIG_UP_RE = /突破|站上|上破|高于|收于.*之上/;

/** 从失效条件文本提取 (方向, 关键数字)；提取失败返回null留待下轮 */
function parseInvalidation(text: string): { direction: "down" | "up"; level: number } | null {
  if (!text) return null;
  const nums = text.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const level = Number(nums[0]);
  if (!Number.isFinite(level) || level <= 0) return null;
  if (TRIG_DOWN_RE.test(text)) return { direction: "down", level };
  if (TRIG_UP_RE.test(text)) return { direction: "up", level };
  return null;
}

/** 现价相对失效位的判定 */
function judge(price: number, direction: "down" | "up", level: number): "invalidated" | "alive" {
  if (direction === "down") return price <= level ? "invalidated" : "alive";
  return price >= level ? "invalidated" : "alive";
}

/** 腾讯行情批量现价：q=usNVDA,usAAPL → {NVDA: 219.34}（美股前缀us；单请求≤20码） */
async function fetchTencentPrices(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < symbols.length; i += 20) {
    const batch = symbols.slice(i, i + 20);
    const q = batch.map((s) => `us${s}`).join(",");
    try {
      const res = await fetch(`https://qt.gtimg.cn/q=${q}`, {
        headers: { Referer: "https://gu.qq.com/", "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      for (const line of text.split(";")) {
        const m = line.match(/v_us([A-Za-z0-9.]+)="([^"]*)"/);
        if (!m) continue;
        const fields = m[2].split("~");
        const price = Number(fields[3]);
        if (Number.isFinite(price) && price > 0) out.set(m[1].toUpperCase(), price);
      }
    } catch {
      // 单批失败跳过，留待下轮
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  if (!authOk(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const ledger = await readAllLedger(500);
  if (!ledger || ledger.length === 0) {
    return NextResponse.json({ ok: true, settled: 0, reason: "ledger_empty" });
  }

  // 已结算集合：kb_dynamic里kind=judgment_settle的(symbol+judged_date)
  const kbRows = await readKbEntries(200);
  const settledKeys = new Set<string>();
  for (const row of kbRows ?? []) {
    if (!row.content.includes('"kind":"judgment_settle"')) continue;
    try {
      const obj = JSON.parse(row.content) as { symbol?: string; judged_date?: string };
      if (obj.symbol && obj.judged_date) settledKeys.add(`${obj.symbol}|${obj.judged_date}`);
    } catch {
      // 解析失败跳过
    }
  }

  // 待结算：有失效条件、90天内、(symbol,date)未结算、同键去重取最新ts
  const candidates = new Map<string, (typeof ledger)[number]>();
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  for (const r of ledger) {
    if (!r.invalidation || !r.symbol || !r.date) continue;
    if (!parseInvalidation(r.invalidation)) continue;
    const t = r.ts ? Date.parse(r.ts) : NaN;
    if (Number.isFinite(t) && t < cutoff) continue;
    const key = `${r.symbol}|${r.date}`;
    const prev = candidates.get(key);
    if (!prev || (prev.ts ?? "") < (r.ts ?? "")) candidates.set(key, r);
  }
  const pending = Array.from(candidates.values()).filter((r) => !settledKeys.has(`${r.symbol}|${r.date}`));
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, settled: 0, reason: "nothing_to_settle", ledger_rows: ledger.length });
  }

  const prices = await fetchTencentPrices(Array.from(new Set(pending.map((r) => r.symbol))));

  const now = new Date().toISOString();
  const rows: KbDynamicRow[] = [];
  const skipped: string[] = [];
  for (const r of pending) {
    const price = prices.get(r.symbol);
    if (!price) {
      skipped.push(r.symbol);
      continue;
    }
    const parsed = parseInvalidation(r.invalidation!);
    if (!parsed) continue;
    const result = judge(price, parsed.direction, parsed.level);
    rows.push({
      id: `settle-${r.symbol}-${r.date}`,
      type: "insight",
      keywords: [r.symbol, "settle", r.date],
      content: JSON.stringify({
        kind: "judgment_settle",
        symbol: r.symbol,
        judged_date: r.date,
        stance: r.stance,
        direction: parsed.direction,
        level: parsed.level,
        settle_price: price,
        result,
        invalidation: r.invalidation,
        settled_at: now,
      }),
      source: "cron-judgment-settle",
      created: now,
    });
  }

  let written = 0;
  if (rows.length > 0) written = (await upsertKbEntries(rows)) ? rows.length : 0;

  return NextResponse.json({
    ok: true,
    settled: written,
    skipped_no_price: skipped,
    pending_total: pending.length,
    ledger_rows: ledger.length,
    sample_prices: Object.fromEntries(Array.from(prices.entries()).slice(0, 5)),
  });
}
