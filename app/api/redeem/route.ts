import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createSupabaseUserClient, SupabaseConfigError } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^FS-[A-Z2-9]{5}-[A-Z2-9]{5}$/),
});

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });

  const input = requestSchema.safeParse(await request.json());
  if (!input.success) {
    return NextResponse.json({ success: false, error: "兑换码格式不正确" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseUserClient(auth.accessToken);
    const { data, error } = await supabase.rpc("redeem_code", { p_code: input.data.code });
    if (error) {
      const message = error.message.includes("code_already_used")
        ? "兑换码已被使用"
        : error.message.includes("invalid_code")
          ? "兑换码无效"
          : "兑换失败，请稍后重试";
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }

    const plan = Array.isArray(data) ? data[0] : null;
    return NextResponse.json(
      {
        success: true,
        plan: plan?.plan,
        calls: plan?.remaining_calls,
        expiresAt: plan?.expires_at,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const status = error instanceof SupabaseConfigError ? 503 : 500;
    return NextResponse.json({ success: false, error: "兑换服务尚未配置" }, { status });
  }
}
