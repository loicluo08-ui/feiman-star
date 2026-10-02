import { NextRequest, NextResponse } from "next/server";
import { supabaseConfigured, sbRest } from "@/lib/supabase";

/**
 * 数据清洗API（10/1自动化授权：逸翔待办的004清洗脚本转为可自动执行）
 * GET /api/admin/cleanup?token=ADMIN_TOKEN → 预览将被清洗的行
 * POST /api/admin/cleanup?token=ADMIN_TOKEN → 执行清洗
 *
 * 清洗范围（六轮检测P2-10+第四轮edge实测）：
 * 1. kb_dynamic里settle_price<=0的脏结算（行情源$0误判）
 * 2. kb_dynamic里失效条件含非价格维度词（PE/估值类）的机械误判结算
 * 3. 部署验证的TEST测试行（judgment_ledger）
 * 4. kb_dynamic里middleware访问日志（type=access_log）的过期清理（保留7天）
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ADMIN = process.env.ADMIN_TOKEN;
  if (!ADMIN) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  const token = request.headers.get("x-admin-token") || new URL(request.url).searchParams.get("token");
  if (token !== ADMIN) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!supabaseConfigured()) return NextResponse.json({ error: "supabase_not_configured" }, { status: 501 });

  // 10/2：username_claim重置（逸翔令：设备全部重新取名）——POST {action:"reset_claims"}（token鉴权后）
  {
    const actionBody = await request.json().catch(() => null) as { action?: string; ips?: string[] } | null;
    if (actionBody?.action === "reset_claims") {
      await sbRest("kb_dynamic?type=eq.username_claim", { method: "DELETE" });
      return NextResponse.json({ ok: true, action: "reset_claims" });
    }
    if (actionBody?.action === "purge_ips" && Array.isArray(actionBody.ips) && actionBody.ips.length > 0) {
      // 按IP清访问日志（测试污染数据清理）——上限20个IP/次
      const ips = actionBody.ips.slice(0, 20).map((x) => String(x));
      let purged = 0;
      for (const ip of ips) {
        // content含ip字段的行逐个查删（PostgREST对JSON内容无法直接过滤——拉近期行内存筛）
        const rows = await sbRest<Array<{ id: string; content: string }>>("kb_dynamic?type=eq.access_log&select=id,content&order=created.desc&limit=1000");
        for (const row of rows ?? []) {
          try {
            const o = JSON.parse(row.content) as { ip?: string };
            if (o.ip === ip) {
              await sbRest(`kb_dynamic?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" });
              purged += 1;
            }
          } catch { /* 坏行跳过 */ }
        }
      }
      return NextResponse.json({ ok: true, action: "purge_ips", purged });
    }
  }

  try {
    const settles = await sbRest<Array<Record<string, unknown>>>(
      "kb_dynamic?source=eq.cron-judgment-settle&select=id,content,created",
    );
    const dirty: string[] = [];
    for (const row of settles ?? []) {
      try {
        const c = JSON.parse(row.content as string) as { settle_price?: number; invalidation?: string };
        const price = c.settle_price;
        const inv = (c.invalidation || "").toString();
        const nonPrice = /\b(PE|PB|PS|ROE|ROA|EPS)\b|市盈率|市净率|股息|增速|回报率|利润率|信心度/.test(inv);
        if ((price !== undefined && price <= 0) || nonPrice) dirty.push(row.id as string);
      } catch {
        dirty.push(row.id as string);
      }
    }
    const testRows = await sbRest<Array<{ id: string }>>(
      "judgment_ledger?symbol=like.TEST*&select=id",
    );
    return NextResponse.json({
      ok: true,
      dryRun: true,
      dirtySettles: dirty,
      testLedgerRows: (testRows ?? []).map((r) => r.id),
      hint: "POST同token执行清洗",
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "query_failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ADMIN = process.env.ADMIN_TOKEN;
  if (!ADMIN) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  const token = request.headers.get("x-admin-token") || new URL(request.url).searchParams.get("token");
  if (token !== ADMIN) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!supabaseConfigured()) return NextResponse.json({ error: "supabase_not_configured" }, { status: 501 });

  // 10/2：username_claim重置（逸翔令：设备全部重新取名）——POST {action:"reset_claims"}（token鉴权后）
  {
    const actionBody = await request.json().catch(() => null) as { action?: string; ips?: string[] } | null;
    if (actionBody?.action === "reset_claims") {
      await sbRest("kb_dynamic?type=eq.username_claim", { method: "DELETE" });
      return NextResponse.json({ ok: true, action: "reset_claims" });
    }
    if (actionBody?.action === "purge_ips" && Array.isArray(actionBody.ips) && actionBody.ips.length > 0) {
      // 按IP清访问日志（测试污染数据清理）——上限20个IP/次
      const ips = actionBody.ips.slice(0, 20).map((x) => String(x));
      let purged = 0;
      for (const ip of ips) {
        // content含ip字段的行逐个查删（PostgREST对JSON内容无法直接过滤——拉近期行内存筛）
        const rows = await sbRest<Array<{ id: string; content: string }>>("kb_dynamic?type=eq.access_log&select=id,content&order=created.desc&limit=1000");
        for (const row of rows ?? []) {
          try {
            const o = JSON.parse(row.content) as { ip?: string };
            if (o.ip === ip) {
              await sbRest(`kb_dynamic?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" });
              purged += 1;
            }
          } catch { /* 坏行跳过 */ }
        }
      }
      return NextResponse.json({ ok: true, action: "purge_ips", purged });
    }
  }

  try {
    // 1) 清脏结算（settle_price<=0 或 非价格维度失效条件）
    const settles = await sbRest<Array<Record<string, unknown>>>(
      "kb_dynamic?source=eq.cron-judgment-settle&select=id,content",
    );
    let settleCleaned = 0;
    for (const row of settles ?? []) {
      let dirty = false;
      try {
        const c = JSON.parse(row.content as string) as { settle_price?: number; invalidation?: string };
        const price = c.settle_price;
        const inv = (c.invalidation || "").toString();
        const nonPrice = /\b(PE|PB|PS|ROE|ROA|EPS)\b|市盈率|市净率|股息|增速|回报率|利润率|信心度/.test(inv);
        if ((price !== undefined && price <= 0) || nonPrice) dirty = true;
      } catch {
        dirty = true;
      }
      if (dirty) {
        await sbRest(`kb_dynamic?id=eq.${encodeURIComponent(row.id as string)}`, { method: "DELETE" });
        settleCleaned += 1;
      }
    }

    // 2) 清TEST测试行（judgment_ledger）
    let testCleaned = 0;
    const testRows = await sbRest<Array<{ id: string }>>("judgment_ledger?symbol=like.TEST*&select=id");
    for (const r of testRows ?? []) {
      await sbRest(`judgment_ledger?id=eq.${encodeURIComponent(r.id)}`, { method: "DELETE" });
      testCleaned += 1;
    }

    // 3) 清过期access_log（7天前）
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    await sbRest(`kb_dynamic?type=eq.access_log&created=lt.${weekAgo}`, { method: "DELETE" });

    return NextResponse.json({ ok: true, settleCleaned, testCleaned, accessLogExpired: "cleaned" });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "cleanup_failed" }, { status: 500 });
  }
}
