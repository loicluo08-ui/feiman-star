import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { supabaseConfigured, sbRest } from "@/lib/supabase";
import { createHash } from "crypto";

/**
 * 用户名唯一性登记（10/2逸翔令：不能重名）
 * POST { name } → 查重（单查询拉全量内存比对，堵N+1放大）→登记
 * id=uname-{sha256(name)前16位}（hash id——中文id直排疑似502根因，盲修）。
 * 重名409+自动建议（名字2/名字3…到10）。自称式：登记防重不防伪（冒充=统计噪音）。
 * 全函数try-catch+console.error落Vercel日志（502定位需要）。
 */
export const runtime = "nodejs";

function claimId(name: string): string {
  return `uname-${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
}

function validName(v: string): boolean {
  return /^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,12}$/.test(v);
}

export async function POST(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request, "usernameClaim", { maxRequests: 5, windowMs: 60_000 });
    if (limited) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    const name = (body?.name ?? "").trim();
    if (!validName(name)) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    if (!supabaseConfigured()) return NextResponse.json({ error: "storage_disabled" }, { status: 501 });

    // 单查询拉全量已登记名（内存比对——堵N+1查询放大：原实现重名建议循环probe最多10次Supabase查询）
    const claimedRows = await sbRest<Array<{ id: string; content: string }>>(
      "kb_dynamic?type=eq.username_claim&select=id,content"
    );
    const claimedNames = new Set<string>();
    for (const row of claimedRows ?? []) {
      try {
        const obj = JSON.parse(row.content) as { name?: string };
        if (obj.name) claimedNames.add(obj.name);
      } catch {
        /* 坏行跳过 */
      }
    }

    if (claimedNames.has(name)) {
      // 自动建议：名字2/名字3…找到未占用的
      for (let i = 2; i <= 99; i++) {
        const candidate = `${name}${i}`;
        if (!claimedNames.has(candidate)) {
          return NextResponse.json({ ok: false, error: "name_taken", suggestion: candidate }, { status: 409 });
        }
      }
      return NextResponse.json({ ok: false, error: "name_taken" }, { status: 409 });
    }

    const row = {
      id: claimId(name),
      type: "username_claim",
      keywords: [name],
      content: JSON.stringify({ name, claimed_at: new Date().toISOString() }),
      source: "username-claim",
      created: new Date().toISOString(),
    };
    // 10/2-502真因：return=minimal返回201+空body→sbRest返回null→原代码误判"写入失败"返回502
    //（实际写入成功——登记表里已有名字实锤）。修：sbRest非2xx会throw，走到这里=写入成功；返回值不作失败依据
    await sbRest("kb_dynamic", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: row,
    });
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    // 全捕获+落Vercel日志（上版502无法定位的教训）
    console.error("[username-claim] claim_failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 120) : "claim_failed" }, { status: 500 });
  }
}
