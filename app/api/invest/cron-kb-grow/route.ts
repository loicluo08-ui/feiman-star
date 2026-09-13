import { NextRequest, NextResponse } from "next/server";

/**
 * KB动态层自动生长（Vercel Cron端点，9/13底层建设P0）
 * 每日自动：拉标的池行情快照→合并（30天过期+同标的替换）→GitHub commit→触发重部署
 * 摆脱AgentMore外部执行器——服务端自跑，cron配置见vercel.json
 * 鉴权：Vercel Cron自带 Authorization: Bearer ${CRON_SECRET}；手动触发 ?token=
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
  return url.searchParams.get("token") === secret;
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
    if (fresh.length === 0) {
      return NextResponse.json({ ok: true, changed: false, reason: "all_sources_failed" });
    }
    const { merged, added } = mergeEntries(entries, fresh);
    if (JSON.stringify(merged) === JSON.stringify(entries)) {
      return NextResponse.json({ ok: true, changed: false, total: entries.length });
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
      // P2③向量化：fresh条目生成embedding入库（语义检索底座），失败静默（关键词路由兜底）
      const { embedTexts } = await import("@/lib/kb-embedding");
      const vectors = await embedTexts(fresh.map((f) => f.content));
      if (vectors) {
        for (let i = 0; i < fresh.length; i++) {
          await updateKbEmbedding(fresh[i].id, vectors[i]);
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
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
