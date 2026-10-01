import { NextRequest, NextResponse } from "next/server";

/**
 * KB动态层自动生长（Vercel Cron端点，9/13底层建设P0）
 * 每日自动：拉标的池行情快照→合并（30天过期+同标的替换）→GitHub commit→触发重部署
 * 摆脱AgentMore外部执行器——服务端自跑，cron配置见vercel.json
 * 鉴权：Vercel Cron自带 Authorization: Bearer ${CRON_SECRET}；手动触发 ?token= 或 ?kbToken=${KB_MANUAL_TOKEN}（10/1新增运维通道——值与CRON_SECRET独立，供部署后即时手动验证）
 * 时序快照同步沉淀 data/snapshots/——历史底座
 */
export const maxDuration = 60;

import { collectSnapshots, mergeEntries, readKBFromGitHub, writeKBToGitHub, writeDailySnapshot } from "@/lib/kb-grow-core";

function authOk(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false; // 未配置secret=端点关闭（防裸奔）
  const auth = request.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  if (url.searchParams.get("token") === secret) return true;
  // 10/1运维通道：KB_MANUAL_TOKEN独立手动验证用（与CRON_SECRET独立，可单独轮换）
  const manual = (process.env.KB_MANUAL_TOKEN || "").trim();
  return !!manual && url.searchParams.get("kbToken") === manual;
}

export async function GET(request: NextRequest) {
  if (!authOk(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.GITHUB_TOKEN || null;  // 9/13：GitHub降为可选备份（Supabase主通道）
  if (!token) {
  }
  try {
    let entries: import("@/lib/kb-grow-core").DynamicEntry[] = [];
    let sha: string | null = null;
    if (token) {
      const gh = await readKBFromGitHub(token);
      entries = gh.entries;
      sha = gh.sha;
    } else {
      const { readKbEntries } = await import("@/lib/supabase");
      const rows = await readKbEntries(200);
      if (rows) {
        entries = rows.map((r) => ({
          id: r.id, type: r.type as import("@/lib/kb-grow-core").DynamicEntry["type"],
          keywords: r.keywords || [], content: r.content,
          source: r.source, created: r.created, expires: r.expires ?? undefined,
        }));
      }
    }
    const fresh = await collectSnapshots();
    // 路2：动态层真生长（10/1知识库整改第一步）——当日快讯AI提炼为投资洞察入动态库
    // 洞察管道独立于快照：失败不阻塞行情快照主流程；两管道产物合并写入（mergeEntries统一去重）
    let insightResult: import("@/lib/kb-grow-core").GrowInsightResult = { insights: [], flashCount: 0, aiOk: false };
    try {
      const { growInsights } = await import("@/lib/kb-grow-core");
      insightResult = await growInsights();
    } catch {
      // 洞察失败静默——快照照常
    }
    const allFresh = [...fresh, ...insightResult.insights];
    if (allFresh.length === 0) {
      return NextResponse.json({ ok: true, changed: false, reason: "all_sources_failed", insights_error: insightResult.error });
    }
    const { merged, added } = mergeEntries(entries, allFresh);
    if (JSON.stringify(merged) === JSON.stringify(entries)) {
      // 无新数据也要补向量化（存量条目embedding为空的补齐——语义检索底座完整化）
      let backfilled = 0;
      try {
        const { readKbEntries, updateKbEmbedding } = await import("@/lib/supabase");
        const { embedTexts } = await import("@/lib/kb-embedding");
        if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
          const rows = await readKbEntries(200);
          const emptyRows = (rows || []).filter((r) => !r.embedding);
          if (emptyRows.length > 0) {
            const vectors = await embedTexts(emptyRows.map((r) => r.content));
            if (vectors) {
              for (let i = 0; i < emptyRows.length; i++) {
                await updateKbEmbedding(emptyRows[i].id, vectors[i]);
                backfilled += 1;
              }
            }
          }
        }
      } catch {
        // 补向量化失败静默
      }
      return NextResponse.json({ ok: true, changed: false, total: entries.length, embed_backfill: backfilled });
    }
    // 主写：Supabase（读路径主源，无GitHub token也全功能）
    const { upsertKbEntries, updateKbEmbedding } = await import("@/lib/supabase");
    await upsertKbEntries(merged);
    let commitSha: string | undefined;
    if (token) {
      const write = await writeKBToGitHub(token, merged, sha);
      commitSha = write.commitSha?.slice(0, 7);
    }
    try {
      void 0;
      // P2③向量化：allFresh条目（快照+洞察）生成embedding入库（语义检索底座），失败静默（关键词路由兜底）
      const { embedTexts } = await import("@/lib/kb-embedding");
      const vectors = await embedTexts(allFresh.map((f) => f.content));
      if (vectors) {
        for (let i = 0; i < allFresh.length; i++) {
          await updateKbEmbedding(allFresh[i].id, vectors[i]);
        }
      }
    } catch {
      // DB写失败不影响git json通道
    }
    try {
      if (token) await writeDailySnapshot(token, fresh);
    } catch {
      // 快照沉淀失败不影响主流程
    }
    return NextResponse.json({
      ok: true, changed: true, added, total: merged.length,
      commit: commitSha,
      symbols: fresh.map((f) => f.keywords[0]),
      insights: { generated: insightResult.insights.length, flashCount: insightResult.flashCount, aiOk: insightResult.aiOk, error: insightResult.error },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
