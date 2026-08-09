import { NextRequest, NextResponse } from "next/server";
import { setSessionCookies } from "@/lib/auth-cookies";
import { createSupabaseAnonClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/chat";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const destination = safeNextPath(request.nextUrl.searchParams.get("next"));
  const loginUrl = new URL("/login", request.url);

  if (!code) {
    loginUrl.searchParams.set("error", "missing_code");
    return NextResponse.redirect(loginUrl);
  }

  try {
    const supabase = createSupabaseAnonClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.session) {
      loginUrl.searchParams.set("error", "callback_failed");
      return NextResponse.redirect(loginUrl);
    }

    const response = NextResponse.redirect(new URL(destination, request.url));
    setSessionCookies(response, data.session);
    return response;
  } catch {
    loginUrl.searchParams.set("error", "auth_unavailable");
    return NextResponse.redirect(loginUrl);
  }
}
