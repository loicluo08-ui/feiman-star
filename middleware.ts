import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE } from "@/lib/auth-cookies";

type RefreshPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

function getConfig() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

function redirectToLogin(request: NextRequest, reason?: string) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (reason) loginUrl.searchParams.set("error", reason);
  const response = NextResponse.redirect(loginUrl);
  response.cookies.delete(AUTH_ACCESS_COOKIE);
  response.cookies.delete(AUTH_REFRESH_COOKIE);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function tokenIsValid(url: string, anonKey: string, accessToken: string) {
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  return response.ok;
}

async function refreshSession(url: string, anonKey: string, refreshToken: string) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  });
  return response.ok ? ((await response.json()) as RefreshPayload) : null;
}

export async function middleware(request: NextRequest) {
  const config = getConfig();
  if (!config) return redirectToLogin(request, "auth_unavailable");

  const accessToken = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
  if (accessToken && (await tokenIsValid(config.url, config.anonKey, accessToken))) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const refreshToken = request.cookies.get(AUTH_REFRESH_COOKIE)?.value;
  if (!refreshToken) return redirectToLogin(request);

  const session = await refreshSession(config.url, config.anonKey, refreshToken);
  if (!session?.access_token || !session.refresh_token) return redirectToLogin(request);

  const response = NextResponse.next();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
  response.cookies.set(AUTH_ACCESS_COOKIE, session.access_token, {
    ...cookieOptions,
    maxAge: session.expires_in ?? 3600,
  });
  response.cookies.set(AUTH_REFRESH_COOKIE, session.refresh_token, {
    ...cookieOptions,
    maxAge: 60 * 60 * 24 * 30,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/chat/:path*", "/tools/:path*", "/knowledge/:path*", "/redeem/:path*"],
};
