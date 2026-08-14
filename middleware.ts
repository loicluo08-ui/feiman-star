import { NextResponse, type NextRequest } from "next/server";

// 费曼星已转为免费工具站，不再需要登录认证。
// middleware 仅保留统一 cache header，不做任何拦截。
export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/invest/:path*"],
};
