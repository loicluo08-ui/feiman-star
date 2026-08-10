import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createSupabaseAdminClient, SupabaseConfigError } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const feedbackSchema = z.object({
  tool: z.enum(["script-generator", "product-copy"]),
  rating: z.union([z.literal(1), z.literal(-1)]),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const input = feedbackSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "反馈参数不正确" }, { status: 400 });

  try {
    const { error } = await createSupabaseAdminClient().from("tool_feedback").insert({
      user_id: auth.user.id,
      tool: input.data.tool,
      rating: input.data.rating,
    });
    if (error) throw error;
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (!(error instanceof SupabaseConfigError)) console.error("[tool-feedback] insert_failed");
    return NextResponse.json({ error: "反馈暂时无法记录" }, { status: 503 });
  }
}
