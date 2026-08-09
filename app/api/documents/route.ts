import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createSupabaseAdminClient, SupabaseConfigError } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("knowledge_files")
      .select("id,filename,mime_type,size_bytes,chunk_count,created_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(
      { data: data ?? [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const status = error instanceof SupabaseConfigError ? 503 : 500;
    return NextResponse.json({ error: "知识库服务尚未配置" }, { status });
  }
}
