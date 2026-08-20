import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 富途数据源诊断端点（仅临时排查用） */
export async function GET(request: NextRequest) {
  const adminToken = process.env.ADMIN_TOKEN;
  const provided = request.headers.get("x-admin-token");
  if (!adminToken || provided !== adminToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const UA =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
  const diag: Record<string, unknown> = {};

  try {
    // step1: 盾页
    const t0 = Date.now();
    const r1 = await fetch("https://www.futunn.com/stock/NVDA-US", {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    const html1 = await r1.text();
    diag.step1 = {
      status: r1.status,
      bytes: html1.length,
      ms: Date.now() - t0,
      head: html1.slice(0, 150),
    };
    const jwts = html1.match(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g);
    diag.step1.jwtCount = jwts?.length ?? 0;
    if (!jwts?.length) {
      return NextResponse.json({ diag, conclusion: "盾页无内嵌JWT——Vercel出口IP被富途区别对待" });
    }

    // step2: 带token
    const t1 = Date.now();
    const r2 = await fetch("https://www.futunn.com/stock/NVDA-US", {
      headers: { "User-Agent": UA, Accept: "text/html", Cookie: `wafToken=${jwts[0]}` },
      signal: AbortSignal.timeout(8000),
    });
    const html2 = await r2.text();
    diag.step2 = {
      status: r2.status,
      bytes: html2.length,
      ms: Date.now() - t1,
      hasStockInfo: html2.includes("stock_info"),
      hasPrice: html2.includes("priceNominal"),
      head: html2.slice(0, 150),
    };
    if (diag.step2.hasPrice) {
      const m = html2.match(/"priceNominal"\s*:\s*"([0-9.]+)"/);
      diag.price = m?.[1];
      diag.conclusion = "Vercel环境富途全流程OK——问题在getFutuStock代码";
    } else {
      diag.conclusion = "token在step2无效——Vercel IP被富途盾二次拦截";
    }
  } catch (e) {
    diag.error = e instanceof Error ? e.message : String(e);
    diag.conclusion = "请求异常（超时/网络）";
  }

  return NextResponse.json({ diag });
}
