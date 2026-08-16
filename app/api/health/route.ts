import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      deepseek: process.env.DEEPSEEK_API_KEY ? "configured" : "missing",
      zhipu: process.env.ZHIPU_API_KEY ? "configured" : "missing",
      finnhub: process.env.FINNHUB_API_KEY ? "configured" : "missing",
    },
  });
}
