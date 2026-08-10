import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export function adminTokenIsValid(request: NextRequest) {
  const expected = process.env.ADMIN_TOKEN ?? "";
  const candidate = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !candidate) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireAdmin(request: NextRequest) {
  if (!process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: "管理员服务尚未配置" }, { status: 503 });
  }
  if (!adminTokenIsValid(request)) {
    return NextResponse.json({ error: "管理员令牌无效" }, { status: 401 });
  }
  return null;
}
