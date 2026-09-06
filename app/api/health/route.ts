import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  // 9/6红队修复（报告B）：不再泄露供应商配置面（deepseek/zhipu/finnhub状态）
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
