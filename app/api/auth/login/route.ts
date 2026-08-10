import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setSessionCookies } from "@/lib/auth-cookies";
import { createSupabaseAnonClient, SupabaseConfigError } from "@/lib/supabase";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(72),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "auth", RATE_LIMITS.auth);
  if (limited) {
    return NextResponse.json(
      { success: false, error: `操作过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }
  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json(
      { success: false, error: "请输入有效邮箱和至少8位密码" },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseAnonClient();
    const { data, error } = await supabase.auth.signInWithPassword(input.data);
    if (error || !data.session || !data.user) {
      console.error(`[auth-login] ${error?.code ?? "session_missing"}`);
      return NextResponse.json(
        { success: false, error: "邮箱或密码不正确，或邮箱尚未完成验证" },
        { status: 401 },
      );
    }

    const response = NextResponse.json({
      success: true,
      user: { id: data.user.id, email: data.user.email },
    });
    setSessionCookies(response, data.session);
    return response;
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return NextResponse.json(
        { success: false, error: "登录服务尚未配置" },
        { status: 503 },
      );
    }
    console.error("[auth-login] unexpected_error");
    return NextResponse.json(
      { success: false, error: "登录失败，请稍后重试" },
      { status: 500 },
    );
  }
}
