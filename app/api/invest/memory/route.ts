// 用户记忆自查/自删API（10/28 AgentMore模式——用户全透明可控，隐私主权）
// GET  /api/invest/memory          → 自己的记忆清单（按fx_username cookie鉴权，游客404空态）
// DELETE /api/invest/memory {index} → 删第index条（下标对齐GET返回顺序）
// 无ADMIN鉴权——数据就是用户自己的（cookie即身份），只读/删自己=零越权面
import { NextRequest, NextResponse } from "next/server";
import { decodeFxUsername, readUserMemory, deleteUserMemoryAt } from "@/lib/user-memory";

export const dynamic = "force-dynamic";

function identityOf(request: NextRequest): string {
  return decodeFxUsername(request.cookies.get("fx_username")?.value);
}

export async function GET(request: NextRequest) {
  const identity = identityOf(request);
  if (!identity) return NextResponse.json({ ok: true, username: "", items: [] });
  const items = await readUserMemory(identity);
  return NextResponse.json({ ok: true, username: identity, items });
}

export async function DELETE(request: NextRequest) {
  const identity = identityOf(request);
  if (!identity) return NextResponse.json({ ok: false, error: "no_identity" }, { status: 401 });
  let index = -1;
  try {
    const body = (await request.json()) as { index?: number };
    index = Number(body.index);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ ok: false, error: "need_index" }, { status: 400 });
  }
  const remaining = await deleteUserMemoryAt(identity, index);
  if (remaining < 0) {
    return NextResponse.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, remaining });
}
