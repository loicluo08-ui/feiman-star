import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { aiBudgetGuard } from "@/lib/ai-budget";
import { gateCheck } from "@/lib/gate";
import { callAI } from "@/lib/ai";
import { buildImpactMessages, parseImpact, STOCK_POOL } from "@/lib/flash-impact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 快讯影响标注（10/4）：批量≤5条 → 利好/利空各≤5只（候选池硬约束防幻觉）
// 缓存：content hash → 内存Map（与快讯源5分钟缓存语义对齐）

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60_000;
// 批量上限5条（免费池吞吐甜点）：5条×10只×理由≤18字≈1600输出token；
// 首版10条/3000token实测数学必截断（后段条目系统性丢失），拆批+前端2并发覆盖
const MAX_ITEMS = 5;

export async function POST(request: NextRequest) {
  // AI消费路由必须过共享口令闸（10/4交叉验证轮补漏：端点02:02建于门禁14:09之前，8路由名单漏了本路由）
  const gated = gateCheck(request, "FX_GATE_TOKEN", "open_until_configured");
  if (gated) return gated;
  const limited = await enforceRateLimitAsync(request, "flashAnalyze", RATE_LIMITS.flashAnalyze);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }
  const budget = await aiBudgetGuard();
  if (!budget.allowed) {
    return NextResponse.json({ error: budget.reason }, { status: 503, headers: { "Retry-After": "600" } });
  }

  let body: { items?: Array<{ id?: string; title?: string; content?: string }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const rawItems = (body.items || [])
    .filter((x) => typeof x.content === "string" && (x.content as string).length >= 5)
    .slice(0, MAX_ITEMS)
    .map((x, i) => ({
      id: String(x.id || `f${i}`),
      title: String(x.title || "").slice(0, 120),
      content: String(x.content).slice(0, 800),
    }));
  if (rawItems.length === 0) {
    return NextResponse.json({ error: "无有效快讯内容" }, { status: 400 });
  }

  // 缓存命中检查（逐条级：混合命中时只评未命中的）
  const now = Date.now();
  const results: Record<string, unknown> = {};
  const pending: typeof rawItems = [];
  for (const it of rawItems) {
    const key = `imp:${hash(it.content)}`;
    const hit = cache.get(key);
    if (hit && now - hit.ts < CACHE_TTL) {
      results[it.id] = hit.data;
    } else {
      pending.push(it);
    }
  }

  let aiRaw = "";
  if (pending.length > 0) {
    const { system, user } = buildImpactMessages(pending);
    try {
      const raw = await callAI(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // json模式不传（10/4实测：json_object强制对象根+部分免费通道对response_format直接400）——
        // 契约靠prompt的{"results":[...]}+parseImpact形态归一解析兜底，全部通道可用性优先
        { task: "extract", temperature: 0.2, max_tokens: 2500, retry: 1, timeout: 60_000 },
      );
      aiRaw = typeof raw === "string" ? raw : String(raw ?? "");
      const parsed = parseImpact(aiRaw, pending.map((p) => p.id));
      for (const p of pending) {
        const val = parsed[p.id];
        if (val) {
          results[p.id] = val;
          cache.set(`imp:${hash(p.content)}`, { data: val, ts: now });
        }
        // 模型漏答/截断条目：不下发也不缓存——前端不存state，下轮items轮询自动重试（空结果缓存5分钟会让缺口固化）
      }
    } catch (err) {
      console.error("[flash-impact] ai_error", err instanceof Error ? err.message : String(err));
      // AI失败：已命中缓存的照常返回；未命中的不下发——前端下轮轮询自动重试
    }
  }

  // 清理过期缓存（防Map无限涨）
  if (cache.size > 500) {
    for (const k of Array.from(cache.keys())) {
      const v = cache.get(k);
      if (v && now - v.ts > CACHE_TTL) cache.delete(k);
    }
  }

  return NextResponse.json(
    {
      data: results,
      pool_size: STOCK_POOL.length,
      timestamp: new Date().toISOString(),
      ...(pending.length > 0 && Object.keys(results).length === 0
        ? { debug: { ai_raw_head: String(aiRaw ?? "").slice(0, 300), ai_raw_len: String(aiRaw ?? "").length } }
        : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
