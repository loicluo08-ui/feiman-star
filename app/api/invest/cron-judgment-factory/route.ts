import { NextRequest, NextResponse } from "next/server";

/**
 * 判断工厂cron（9/25 V3融入第二批——判断库发动机）
 * 链路：runFactory规则扫描（13大师启发式机械触发）→ 去重 → insertLedgerRows入库
 *   → cron-judgment-settle（每日UTC22:00）核价结算——闭环补全9/18空转风险
 *
 * 诚实边界：产出=规则触发的结构化信号（非AI观点非大师本人判断），
 *   每条带master签名+basis[数据]标注，符号后缀"(信号)"可在账本层识别过滤。
 * 鉴权：Authorization: Bearer ${CRON_SECRET} 或 ?token=${CRON_SECRET}（同cron-judgment-settle）
 */
export const maxDuration = 60;

import { insertLedgerRows, readAllLedger } from "@/lib/supabase";
import { runFactory } from "@/lib/judgment-factory";

function authOk(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("token") === secret;
}

export async function GET(request: NextRequest) {
  if (!authOk(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }
  try {
    const produced = await runFactory();
    if (!produced.length) {
      return NextResponse.json({ ok: true, produced: 0, note: "今日无规则触发（正常——多数交易日多数规则不触发）" });
    }

    // 去重：同symbol+同date+同invalidation已有账本行则跳过
    const existing = (await readAllLedger(200)) ?? [];
    const seen = new Set(existing.map((r) => `${r.symbol}|${r.date}|${r.invalidation ?? ""}`));
    const fresh = produced.filter((c) => {
      const key = `${c.symbol}|${c.date}|${c.invalidation}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (!fresh.length) {
      return NextResponse.json({ ok: true, produced: produced.length, inserted: 0, note: "触发信号均为已入账本的去重项" });
    }

    const ok = await insertLedgerRows(
      fresh.map((c) => ({
        symbol: `${c.symbol}(${c.master.split("（")[0]}信号)`,
        stance: c.stance,
        key_level: c.keyLevel,
        invalidation: c.invalidation,
        confidence: c.confidence,
        date: c.date,
        ts: String(c.ts),
      }))
    );

    return NextResponse.json({
      ok, inserted: ok ? fresh.length : 0,
      items: fresh.map((c) => ({ symbol: c.symbol, master: c.master, stance: c.stance, invalidation: c.invalidation })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "factory failed" }, { status: 500 });
  }
}
