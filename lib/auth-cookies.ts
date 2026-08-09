import type { NextResponse } from "next/server";
import type { Session } from "@supabase/supabase-js";

export const AUTH_ACCESS_COOKIE = "fs-access-token";
export const AUTH_REFRESH_COOKIE = "fs-refresh-token";

const ACCESS_MAX_AGE_SECONDS = 60 * 60;
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function setSessionCookies(response: NextResponse, session: Session) {
  response.cookies.set(
    AUTH_ACCESS_COOKIE,
    session.access_token,
    cookieOptions(session.expires_in ?? ACCESS_MAX_AGE_SECONDS),
  );
  response.cookies.set(
    AUTH_REFRESH_COOKIE,
    session.refresh_token,
    cookieOptions(REFRESH_MAX_AGE_SECONDS),
  );
  response.headers.set("Cache-Control", "private, no-store");
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(AUTH_ACCESS_COOKIE, "", cookieOptions(0));
  response.cookies.set(AUTH_REFRESH_COOKIE, "", cookieOptions(0));
  response.headers.set("Cache-Control", "private, no-store");
}
