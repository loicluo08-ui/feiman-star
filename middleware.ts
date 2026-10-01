import { NextResponse, type NextRequest } from "next/server";

// 使用监控采集（10/1逸翔令：后台看每个用户使用情况+IP）
// 设计：/invest/*页面与API全量采集，fire-and-forget写Supabase access_logs（表见sql/005_access_logs.sql），
// 写入失败静默（监控不阻塞主功能）。IP取x-forwarded-for首段，geo用Vercel注入头（免费）。
// 排除：/admin自身（防自记录死循环）、无IP的本地健康检查。

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function clientIP(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");

  const path = request.nextUrl.pathname;
  if (path.startsWith("/invest/admin")) return response; // 后台自身不记录

  // 采集：Supabase配置完整才发（未建表/未配key静默跳过）
  if (SUPABASE_URL && SUPABASE_KEY) {
    const ip = clientIP(request);
    const payload = JSON.stringify({
      ip,
      path,
      method: request.method,
      ua: (request.headers.get("user-agent") || "").slice(0, 300),
      country: request.headers.get("x-vercel-ip-country") || null,
      city: request.headers.get("x-vercel-ip-city") || null,
      referer: (request.headers.get("referer") || "").slice(0, 300),
    });
    try {
      // 不await完成——发出即走（Edge允许floating fetch，超时由平台托管；失败静默）
      void fetch(`${SUPABASE_URL}/rest/v1/access_logs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: payload,
        cache: "no-store",
      }).catch(() => {});
    } catch {
      // 监控永不阻塞主功能
    }
  }

  return response;
}

export const config = {
  matcher: ["/invest/:path*"],
};
