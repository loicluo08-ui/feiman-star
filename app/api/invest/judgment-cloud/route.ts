import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { supabaseConfigured, insertLedgerRows, readAllLedger } from "@/lib/supabase";
import { parseInvalidation } from "@/lib/settle-recall";

/**
 * 判断记账云端直写（10/1六轮检测P1-sync修复——判断云端同步全链路死亡）
 *
 * 原链路：chat → judgment-sync → GitHub judgments.json（Vercel无GITHUB_TOKEN=sync_disabled=501，
 * 前端catch静默吞错）→ 回验cron候选池断供；Supabase judgment_ledger无写入方 → ledger页永远0条
 * → 结算cron空转。
 *
 * 本路由：前端done后POST新增entries → Supabase judgment_ledger直写（insertLedgerRows现成函数）
 * → ledger页立即可见 → 结算cron有对象可结算 → 判断追踪命脉接通。
 * 原 GitHub 通道（judgment-sync）保留并行调用，未来配 GITHUB_TOKEN 后恢复候选池供血。
 *
 * 安全：同源白名单（严格精确匹配）+ IP限流
 * 数据校验：字段级白名单+长度上限+类型校验——防注入写入垃圾行
 */

const ALLOWED_ORIGINS = new Set([
  "https://sufve.com",
  "https://feiman-star.vercel.app",
  "http://localhost:3000",
]);

interface CloudEntry {
  symbol: string;
  stance: string;
  key_level: string;
  invalidation: string;
  confidence: string;
  date: string;
  ts: string;
}

function sanitizeEntry(raw: unknown): CloudEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" ? v.slice(0, max).trim() : "";
  const symbol = str(e.symbol, 40);
  const stance = str(e.stance, 20);
  const keyLevel = str(e.keyLevel ?? e.key_level, 60);
  const invalidation = str(e.invalidation, 200);
  const confidence = str(e.confidence, 20);
  const date = str(e.date, 10);
  const tsNum = typeof e.ts === "number" ? e.ts : Number(e.ts);
  if (!symbol || !stance || !date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!Number.isFinite(tsNum)) return null;
  return {
    symbol,
    stance,
    key_level: keyLevel,
    invalidation,
    confidence,
    date,
    ts: new Date(tsNum).toISOString(),
  };
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "judgmentCloud", { maxRequests: 30, windowMs: 60_000 });
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const origin = request.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }

  if (!supabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 501 });
  }

  let body: { entries?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const rawList = Array.isArray(body.entries) ? body.entries.slice(0, 50) : [];
  const rows = rawList
    .map(sanitizeEntry)
    .filter((r): r is CloudEntry => r !== null)
    .map((r) => ({
      symbol: r.symbol,
      stance: r.stance,
      key_level: r.key_level || null,
      invalidation: r.invalidation || null,
      confidence: r.confidence || null,
      date: r.date,
      ts: r.ts,
      // 10/1入账质量闸：失效条件可机械核验=strict（cron按价位结算进对错率）；叙事型=narrative（跳过结算只计数）——
      // 此前该字段从未落地，narrative/strict区分空转
      failure_strictness: r.invalidation && parseInvalidation(r.invalidation) ? "strict" : "narrative",
    }));

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, written: 0, reason: "no_valid_entries" });
  }

  // 10/2漏洞审计P1修复①：单请求同symbol限3条（防单请求刷同标的垃圾判断）
  const perSymbol = new Map<string, number>();
  for (const r of rows) perSymbol.set(r.symbol, (perSymbol.get(r.symbol) ?? 0) + 1);
  const flooded = Array.from(perSymbol.entries()).find(([, n]) => n > 3);
  if (flooded) {
    return NextResponse.json(
      { ok: false, error: `symbol_flood:${flooded[0]}` },
      { status: 429 },
    );
  }

  // 10/2漏洞审计P1修复②：重复判断跳过（symbol+date+invalidation三键相同=已有记录，伪造重放无收益）
  let deduped = rows;
  try {
    const existing = await readAllLedger(500);
    if (existing && existing.length > 0) {
      const seen = new Set(existing.map((e) => `${e.symbol}|${e.date}|${e.invalidation ?? ""}`));
      deduped = rows.filter((r) => !seen.has(`${r.symbol}|${r.date}|${r.invalidation ?? ""}`));
    }
  } catch {
    // 查重失败不挡写入（可用性优先，去重是增强）
  }
  if (deduped.length === 0) {
    return NextResponse.json({ ok: true, written: 0, reason: "all_duplicates" });
  }

  const ok = await insertLedgerRows(deduped as never[]);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "supabase_write_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, written: rows.length });
}
