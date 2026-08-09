import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_ACCESS_COOKIE, clearSessionCookies } from "@/lib/auth-cookies";
import { createSupabaseUserClient, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST() {
  const accessToken = cookies().get(AUTH_ACCESS_COOKIE)?.value;
  if (accessToken && isSupabaseConfigured()) {
    const supabase = createSupabaseUserClient(accessToken);
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookies(response);
  return response;
}
