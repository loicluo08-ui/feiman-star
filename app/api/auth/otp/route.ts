import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAnonClient,
  SupabaseConfigError,
} from "@/lib/supabase";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "请输入包含国家区号的手机号"),
  createUser: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const input = requestSchema.safeParse(await request.json());
    if (!input.success) {
      return NextResponse.json(
        { success: false, error: "手机号格式不正确" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAnonClient();
    const { error } = await supabase.auth.signInWithOtp({
      phone: input.data.phone,
      options: { shouldCreateUser: input.data.createUser },
    });

    if (error) {
      console.error(`[auth-otp] ${error.code ?? "request_failed"}`);
      return NextResponse.json(
        { success: false, error: "验证码发送失败，请确认手机号或稍后重试" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return NextResponse.json(
        { success: false, error: "登录服务尚未配置" },
        { status: 503 },
      );
    }
    console.error("[auth-otp] unexpected_error");
    return NextResponse.json(
      { success: false, error: "验证码发送失败，请稍后重试" },
      { status: 500 },
    );
  }
}
