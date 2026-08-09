import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setSessionCookies } from "@/lib/auth-cookies";
import {
  createSupabaseAnonClient,
  SupabaseConfigError,
} from "@/lib/supabase";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  token: z.string().regex(/^\d{6}$/),
});

export async function POST(request: NextRequest) {
  try {
    const input = requestSchema.safeParse(await request.json());
    if (!input.success) {
      return NextResponse.json(
        { success: false, error: "手机号或验证码格式不正确" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAnonClient();
    const { data, error } = await supabase.auth.verifyOtp({
      phone: input.data.phone,
      token: input.data.token,
      type: "sms",
    });

    if (error || !data.session) {
      console.error(`[auth-verify] ${error?.code ?? "session_missing"}`);
      return NextResponse.json(
        { success: false, error: "验证码无效或已过期" },
        { status: 401 },
      );
    }

    const response = NextResponse.json({
      success: true,
      user: { id: data.user?.id, phone: data.user?.phone },
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
    console.error("[auth-verify] unexpected_error");
    return NextResponse.json(
      { success: false, error: "登录失败，请稍后重试" },
      { status: 500 },
    );
  }
}
