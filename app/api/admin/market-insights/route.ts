import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createSupabaseAdminClient, SupabaseConfigError } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  platform: z.string().trim().max(64).optional(),
  industry: z.string().trim().max(64).optional(),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]).optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
});

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const input = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!input.success) return NextResponse.json({ error: "筛选参数不正确" }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const pageSize = 30;
    let query = admin
      .from("market_insights")
      .select("id,platform,industry,insight_text,source_url,sentiment", { count: "exact" })
      .order("id", { ascending: true });
    if (input.data.platform) query = query.eq("platform", input.data.platform);
    if (input.data.industry) query = query.eq("industry", input.data.industry);
    if (input.data.sentiment) query = query.eq("sentiment", input.data.sentiment);
    const start = (input.data.page - 1) * pageSize;
    const [{ data, error, count }, optionsResult] = await Promise.all([
      query.range(start, start + pageSize - 1),
      admin.from("market_insights").select("platform,industry,sentiment"),
    ]);
    if (error ?? optionsResult.error) throw error ?? optionsResult.error;
    const options = optionsResult.data ?? [];
    return NextResponse.json(
      {
        data: data ?? [],
        count: count ?? 0,
        page: input.data.page,
        pageSize,
        options: {
          platforms: Array.from(new Set(options.map((item) => item.platform))).sort(),
          industries: Array.from(new Set(options.map((item) => item.industry))).sort(),
          sentiments: Array.from(new Set(options.map((item) => item.sentiment))).sort(),
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (!(error instanceof SupabaseConfigError)) console.error("[admin-insights] query_failed");
    return NextResponse.json({ error: "市场情报暂时不可用" }, { status: 503 });
  }
}
