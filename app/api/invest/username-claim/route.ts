import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { supabaseConfigured, sbRest } from "@/lib/supabase";

/**
 * 用户名唯一性登记（10/2逸翔令：不能重名+自报城市）
 * POST { name, city? } → kb_dynamic查重（type=username_claim, id=uname-{name}）→登记
 * 重名409+自动建议（罗逸翔2/罗逸翔3…最多试到10）。自称式：登记防重不防伪（冒充=统计噪音）。
 * 城市自报（本人填的百分百准——IP库城市精度到不了县级，实测上杭→厦门）。
 */
export const runtime = "nodejs";

function validName(v: string): boolean {
  return /^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,12}$/.test(v);
}
function validCity(v: string): boolean {
  return v === "" || /^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,12}$/.test(v);
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "usernameClaim", RATE_LIMITS.search);
  if (limited) {
    return NextResponse.json({ error: `请求过于频繁` }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { name?: string; city?: string } | null;
  const name = (body?.name ?? "").trim();
  const city = (body?.city ?? "").trim();
  if (!validName(name)) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  if (!validCity(city)) return NextResponse.json({ error: "invalid_city" }, { status: 400 });
  if (!supabaseConfigured()) return NextResponse.json({ error: "storage_disabled" }, { status: 501 });

  const rowId = `uname-${name}`;
  try {
    // 查重：id精确匹配（id=uname-名字，名字即唯一键）
    const existing = await sbRest<Array<{ id: string }>>(`kb_dynamic?id=eq.${encodeURIComponent(rowId)}&select=id`);
    if (existing && existing.length > 0) {
      // 自动建议：罗逸翔2/罗逸翔3…找到未占用的（最多10轮）
      for (let i = 2; i <= 10; i++) {
        const candidate = `${name}${i}`;
        const probe = await sbRest<Array<{ id: string }>>(`kb_dynamic?id=eq.${encodeURIComponent(`uname-${candidate}`)}&select=id`);
        if (!probe || probe.length === 0) {
          return NextResponse.json({ ok: false, error: "name_taken", suggestion: candidate }, { status: 409 });
        }
      }
      return NextResponse.json({ ok: false, error: "name_taken" }, { status: 409 });
    }

    // 登记
    const row = {
      id: rowId,
      type: "username_claim",
      keywords: [name],
      content: JSON.stringify({ name, city: city || null, claimed_at: new Date().toISOString() }),
      source: "username-claim",
      created: new Date().toISOString(),
    };
    const ok = await sbRest("kb_dynamic", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: row,
    });
    if (!ok) return NextResponse.json({ error: "claim_write_failed" }, { status: 502 });
    return NextResponse.json({ ok: true, name, city: city || null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 100) : "claim_failed" }, { status: 500 });
  }
}
