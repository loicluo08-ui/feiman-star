import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createSupabaseAdminClient, SupabaseConfigError } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const id = idSchema.safeParse(params.id);
  if (!id.success) return NextResponse.json({ error: "文档ID不正确" }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("knowledge_files")
      .delete()
      .eq("id", id.data)
      .eq("user_id", auth.user.id)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: "删除失败" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const status = error instanceof SupabaseConfigError ? 503 : 500;
    return NextResponse.json({ error: "知识库服务尚未配置" }, { status });
  }
}
