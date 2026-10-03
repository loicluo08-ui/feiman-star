import { NextRequest, NextResponse } from "next/server";

/**
 * AI厂商通道健康探测（10/3：智谱429零向量72h无人发现的探测缺位补丁）
 * GET /api/admin/ai-probe?token=ADMIN_TOKEN
 * 逐通道真实ping（max_tokens=5, 12s超时）→ 可用性/延迟/模型/错误明细
 * 用途：巡检cron集成 + 人工排查"哪个免费池还活着"
 * 鉴权：?token=对比ADMIN_TOKEN（cleanup/monthly-report同款模式）
 */
export const maxDuration = 60;

import { CHANNELS } from "@/lib/model-gateway";

interface ProbeRow {
  channel: string;
  configured: boolean;
  ok: boolean;
  latencyMs: number;
  model: string;
  free: boolean;
  error?: string;
}

export async function GET(request: NextRequest) {
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) {
    return NextResponse.json({ ok: false, error: "ADMIN_TOKEN未配置，端点关闭" }, { status: 503 });
  }
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (token !== adminToken) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const rows: ProbeRow[] = [];
  for (const ch of Object.values(CHANNELS)) {
    const key = (process.env[ch.keyEnv] || "").trim();
    const model = (process.env[ch.modelEnv] || ch.modelDefault).trim();
    if (!key) {
      rows.push({ channel: ch.name, configured: false, ok: false, latencyMs: 0, model, free: ch.free, error: "no_key" });
      continue;
    }
    const base = (process.env[ch.baseEnv] || ch.baseDefault).replace(/\/$/, "");
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...(ch.extraHeaders ?? {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latency = Date.now() - t0;
      if (res.ok) {
        rows.push({ channel: ch.name, configured: true, ok: true, latencyMs: latency, model, free: ch.free });
      } else {
        const body = await res.text().catch(() => "");
        rows.push({ channel: ch.name, configured: true, ok: false, latencyMs: latency, model, free: ch.free, error: `HTTP ${res.status}: ${body.slice(0, 120)}` });
      }
    } catch (e) {
      rows.push({
        channel: ch.name, configured: true, ok: false, latencyMs: Date.now() - t0, model, free: ch.free,
        error: e instanceof Error ? (e.name === "AbortError" ? "timeout(12s)" : e.message.slice(0, 120)) : String(e).slice(0, 120),
      });
    }
  }

  const alive = rows.filter((r) => r.ok);
  return NextResponse.json({
    ok: true,
    total: rows.length,
    alive: alive.length,
    freeAlive: alive.filter((r) => r.free).length,
    rows,
    checkedAt: new Date().toISOString(),
  });
}
