import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const results: Record<string, unknown> = {};

  // 1. 腾讯行情（美股 us+代码）
  try {
    const t0 = Date.now();
    const r = await fetch("https://qt.gtimg.cn/q=usNVDA,usAAPL", {
      headers: { "User-Agent": UA, Referer: "https://gu.qq.com/" },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    results.tencent = {
      status: r.status,
      ms: Date.now() - t0,
      bytes: text.length,
      sample: text.slice(0, 180),
      hasPrice: /usNVDA/.test(text) && /\d+\.\d+/.test(text),
    };
  } catch (e) {
    results.tencent = { error: e instanceof Error ? e.message : String(e) };
  }

  // 2. 新浪行情（美股 gb_前缀，必须带Referer）
  try {
    const t0 = Date.now();
    const r = await fetch("https://hq.sinajs.cn/list=gb_nvda,gb_aapl", {
      headers: {
        "User-Agent": UA,
        Referer: "https://finance.sina.com.cn/",
      },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    results.sina = {
      status: r.status,
      ms: Date.now() - t0,
      bytes: text.length,
      sample: text.slice(0, 180),
      hasPrice: text.includes("gb_nvda") && /\d+\.\d+/.test(text),
    };
  } catch (e) {
    results.sina = { error: e instanceof Error ? e.message : String(e) };
  }

  // 3. 富途（对照：确认失败层）
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
    results.futu = {
      status: r.status,
      ms: Date.now() - t0,
      bytes: html.length,
      jwtCount,
      hasStockInfo: html.includes("stock_info"),
      head: html.slice(0, 120),
    };
  } catch (e) {
    results.futu = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({
    env: "vercel",
    verdict: {
      tencent:
        results.tencent && "hasPrice" in results.tencent
          ? results.tencent.hasPrice
            ? "✅可用"
            : "⚠️响应但无数据"
          : "❌不通",
      sina:
        results.sina && "hasPrice" in results.sina
          ? results.sina.hasPrice
            ? "✅可用"
            : "⚠️响应但无数据"
          : "❌不通",
      futu:
        results.futu && "jwtCount" in results.futu
          ? results.futu.jwtCount > 0
            ? "✅可过盾"
            : "❌盾页无JWT(IP被区别对待)"
          : "❌不通",
    },
    detail: results,
  });
}
