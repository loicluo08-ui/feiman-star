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
    const { data, error } = await supabase.auth.signUp(input.data);
    if (error || !data.user) {
      console.error(`[auth-register] ${error?.code ?? "user_missing"}`);
      return NextResponse.json(
        { success: false, error: "注册失败，请确认邮箱有效或稍后重试" },
        { status: 400 },
      );
    }

    if (!data.session) {
      return NextResponse.json(
        { success: true, requiresEmailConfirmation: true },
        { status: 201, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const response = NextResponse.json(
      {
        success: true,
        requiresEmailConfirmation: false,
        user: { id: data.user.id, email: data.user.email },
      },
      { status: 201 },
    );
    setSessionCookies(response, data.session);
    return response;
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return NextResponse.json(
        { success: false, error: "注册服务尚未配置" },
        { status: 503 },
      );
    }
    console.error("[auth-register] unexpected_error");
    return NextResponse.json(
      { success: false, error: "注册失败，请稍后重试" },
      { status: 500 },
    );
  }
}
