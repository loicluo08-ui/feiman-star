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
    const { merged: mergedRaw, added } = mergeEntries(entries, allFresh);
    // 10/1实测：insight重跑时同id新旧两份共存→PostgREST "affect row a second time" 500——按id保留最新
    const merged = Array.from(new Map(mergedRaw.map((e) => [e.id, e])).values());
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
            } else {
              console.error(`[cron-kb-grow] 存量回填向量化返回空（${emptyRows.length}条待补）`);
            }
          }
        }
      } catch (bfErr) {
        console.error("[cron-kb-grow] 无新数据分支的存量回填异常:", bfErr instanceof Error ? bfErr.message : String(bfErr));
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
      // P2③向量化：allFresh条目（快照+洞察）生成embedding入库（语义检索底座）
      // 10/3教训：原为"失败静默（关键词路由兜底）"——智谱embedding-2余额不足429连续被拒72h、库存0向量无人知晓。
      // 10/3换SiliconFlow免费模型+失败全部可观测（见output/ops_log/kb_semantic_audit_1003.md）
      const { embedTexts } = await import("@/lib/kb-embedding");
      const vectors = await embedTexts(allFresh.map((f) => f.content));
      if (!vectors) {
        console.error(`[cron-kb-grow] 向量化返回空——新条目${allFresh.length}条无向量，语义检索将无法召回（关键词路由兜底中）`);
      } else {
        let embFail = 0;
        for (let i = 0; i < allFresh.length; i++) {
          const ok = await updateKbEmbedding(allFresh[i].id, vectors[i]);
          if (!ok) embFail += 1;
        }
        if (embFail > 0) console.error(`[cron-kb-grow] 向量写入失败${embFail}/${allFresh.length}条`);
      }
    } catch (embErr) {
      console.error("[cron-kb-grow] 向量化段异常:", embErr instanceof Error ? embErr.message : String(embErr));
    }
    // 10/3增强：存量embedding回填每次轮次都跑（原逻辑只在"无新数据"分支触发——
    // 而每3小时快照必有更新，该分支实际永远不进=存量空embedding条目永远无法被语义检索召回）
    try {
      const { readKbEntries, updateKbEmbedding: updEmb } = await import("@/lib/supabase");
      const { embedTexts: emb2 } = await import("@/lib/kb-embedding");
      const allRows = (await readKbEntries(200)) || [];
      const emptyRows = allRows.filter((r) => !r.embedding && (!r.expires || r.expires >= new Date().toISOString().slice(0, 10)));
      if (emptyRows.length > 0) {
        const vecs = await emb2(emptyRows.map((r) => r.content));
        if (vecs) {
          let fillFail = 0;
          for (let i = 0; i < emptyRows.length; i++) {
            const ok = await updEmb(emptyRows[i].id, vecs[i]);
            if (!ok) fillFail += 1;
          }
          if (fillFail > 0) console.error(`[cron-kb-grow] 存量回填写入失败${fillFail}/${emptyRows.length}条`);
          console.log(`[cron-kb-grow] embedding回填${emptyRows.length - fillFail}条存量条目`);
        } else {
          console.error(`[cron-kb-grow] 存量回填向量化返回空（${emptyRows.length}条待补）`);
        }
      }
    } catch (rfErr) {
      console.error("[cron-kb-grow] 存量embedding回填异常:", rfErr instanceof Error ? rfErr.message : String(rfErr));
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
