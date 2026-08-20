import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProbeResult {
  status?: number;
  ms?: number;
  bytes?: number;
  sample?: string;
  hasPrice?: boolean;
  jwtCount?: number;
  hasStockInfo?: boolean;
  head?: string;
  error?: string;
}

interface Probe {
  ok: boolean;
  label: string;
  detail: ProbeResult;
}

function verdictOf(p: Probe | undefined): string {
  if (!p) return "❌不通";
  if (p.detail.error) return `❌${p.detail.error.slice(0, 60)}`;
  return p.ok ? "✅可用" : "⚠️响应但无数据";
}

/**
 * 多行情源连通性探测（Vercel环境）
 * 测：腾讯qt.gtimg.cn / 新浪hq.sinajs.cn / 富途futunn.com
 */
export async function GET(request: NextRequest) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || request.headers.get("x-admin-token") !== adminToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const UA =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

  // 1. 腾讯行情（美股 us+代码）
  const tencent: Probe = { ok: false, label: "tencent", detail: {} };
  try {
    const t0 = Date.now();
    const r = await fetch("https://qt.gtimg.cn/q=usNVDA,usAAPL", {
      headers: { "User-Agent": UA, Referer: "https://gu.qq.com/" },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    tencent.detail = {
      status: r.status,
      ms: Date.now() - t0,
      bytes: text.length,
      sample: text.slice(0, 180),
      hasPrice: text.includes("usNVDA") && /\d+\.\d+/.test(text),
    };
    tencent.ok = Boolean(tencent.detail.hasPrice);
  } catch (e) {
    tencent.detail.error = e instanceof Error ? e.message : String(e);
  }

  // 2. 新浪行情（美股 gb_前缀，必须带Referer）
  const sina: Probe = { ok: false, label: "sina", detail: {} };
  try {
    const t0 = Date.now();
    const r = await fetch("https://hq.sinajs.cn/list=gb_nvda,gb_aapl", {
      headers: { "User-Agent": UA, Referer: "https://finance.sina.com.cn/" },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    sina.detail = {
      status: r.status,
      ms: Date.now() - t0,
      bytes: text.length,
      sample: text.slice(0, 180),
      hasPrice: text.includes("gb_nvda") && /\d+\.\d+/.test(text),
    };
    sina.ok = Boolean(sina.detail.hasPrice);
  } catch (e) {
    sina.detail.error = e instanceof Error ? e.message : String(e);
  }

  // 3. 富途（对照：确认失败层）
  const futu: Probe = { ok: false, label: "futu", detail: {} };
  try {
    const t0 = Date.now();
    const r = await fetch("https://www.futunn.com/stock/NVDA-US", {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    const html = await r.text();
    const jwtCount = (
      html.match(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g) ?? []
    ).length;
    futu.detail = {
      status: r.status,
      ms: Date.now() - t0,
      bytes: html.length,
      jwtCount,
      hasStockInfo: html.includes("stock_info"),
      head: html.slice(0, 120),
    };
    futu.ok = jwtCount > 0 || Boolean(futu.detail.hasStockInfo);
  } catch (e) {
    futu.detail.error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    env: "vercel",
    verdict: {
      tencent: verdictOf(tencent),
      sina: verdictOf(sina),
      futu: futu.detail.error
        ? `❌${futu.detail.error.slice(0, 60)}`
        : futu.detail.hasStockInfo
          ? "✅直连SSR"
          : (futu.detail.jwtCount ?? 0) > 0
            ? "✅可过盾"
            : "❌盾页无JWT(IP被区别对待)",
    },
    detail: { tencent: tencent.detail, sina: sina.detail, futu: futu.detail },
  });
}
