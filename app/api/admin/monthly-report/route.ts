import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { supabaseConfigured, sbRest } from "@/lib/supabase";
import { callAI } from "@/lib/ai";

/**
 * 月度归因报告（10/1效用深化：判断账本从write-only变read-write——效用乘法器第一名）
 * GET /api/admin/monthly-report?token=ADMIN_TOKEN&month=2026-10
 * 流程：读当月judgment_ledger判断+kb_dynamic结算结果 → 数据汇总 → AI生成归因报告（共性分析/最值得复盘三条/下月建议）
 * 由cron每月1日调用，报告推微信。
 */

export const dynamic = "force-dynamic";

type LedgerRow = {
  symbol: string;
  stance: string;
  key_level?: string;
  invalidation?: string;
  confidence?: string;
  date: string;
};

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "admin", RATE_LIMITS.admin);
  if (limited) return NextResponse.json({ ok: false, error: "rate_limited", retryAfter: limited.retryAfter }, { status: 429 });

  const ADMIN = process.env.ADMIN_TOKEN;
  if (!ADMIN) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  const url = new URL(request.url);
  const token = request.headers.get("x-admin-token") || url.searchParams.get("token");
  if (token !== ADMIN) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!supabaseConfigured()) return NextResponse.json({ error: "supabase_not_configured" }, { status: 501 });

  const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7); // YYYY-MM

  try {
    // 读本月判断
    const ledger = await sbRest<Array<LedgerRow>>(
      `judgment_ledger?date=gte.${month}-01&date=lte.${month}-31&select=symbol,stance,key_level,invalidation,confidence,date&order=date.asc&limit=200`,
    );
    const rows = ledger ?? [];

    // 读本月结算结果
    const settles = await sbRest<Array<{ id: string; content: string; created: string }>>(
      `kb_dynamic?type=eq.insight&source=eq.cron-judgment-settle&select=id,content,created&order=created.desc&limit=400`,
    );
    const settleList = (settles ?? [])
      .map((s) => {
        try {
          return JSON.parse(s.content) as { symbol: string; result: string; settle_price: number; judged_date: string };
        } catch {
          return null;
        }
      })
      .filter((x): x is { symbol: string; result: string; settle_price: number; judged_date: string } => x !== null && x.judged_date?.startsWith(month));

    const invalidated = settleList.filter((s) => s.result === "invalidated").length;
    const alive = settleList.filter((s) => s.result === "alive").length;
    const signalDone = settleList.filter((s) => s.result === "signal_done").length;
    const expiredN = settleList.filter((s) => s.result === "expired").length;

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        month,
        empty: true,
        report: `# ${month} 判断归因报告\n\n本月暂无判断记录。\n\n判断库需要持续喂养——每月的判断+结算+归因是认知训练的核心循环。`,
      });
    }

    // 数据摘要给AI
    const ledgerText = rows
      .map((r) => `${r.date} ${r.symbol} | 立场=${r.stance} | 关键位=${r.key_level || "—"} | 失效=${r.invalidation || "—"} | 信心度=${r.confidence || "—"}`)
      .join("\n");
    const settleText =
      settleList.length > 0
        ? settleList.map((s) => `${s.judged_date} ${s.symbol}: ${s.result}`).join("\n")
        : "本月暂无机械结算结果（判断尚未到验证期）";

    const prompt = `你是逸翔的投资判断教练。以下是${month}的全部判断记录与机械结算结果，请生成月度归因报告。

## 判断记录
${ledgerText}

## 机械结算结果
${settleText}

## 统计
总判断${rows.length}条；已结算：失效触发${invalidated}、存活${alive}、信号完成${signalDone}、时间盒到期${expiredN}

## 报告要求（中文，markdown，600字内，说人话）
1. **本月总评**：一两句——判断质量整体如何，最突出的问题是什么
2. **对错分析**：已结算判断中对错的比例与原因归类（方向错/时机错/失效条件设错）
3. **最值得复盘的三条**：挑出问题最大或最有学习价值的三条判断，各一句为什么
4. **共性模式**：判断里的系统性偏差（如总是信心度偏高/失效条件总是设太远/某类标的上反复错）
5. **下月一条建议**：只给一条最优先的改进动作

禁止套话免责。直接给判断。`;

    const aiResp = await callAI([{ role: "user", content: prompt }], { temperature: 0.3, max_tokens: 1500 });
    if (!aiResp) {
      return NextResponse.json({ ok: false, error: "ai_no_response" }, { status: 502 });
    }
    const report = aiResp;

    return NextResponse.json({ ok: true, month, empty: false, stats: { total: rows.length, invalidated, alive, signalDone, expiredN }, report });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "report_failed" }, { status: 500 });
  }
}
