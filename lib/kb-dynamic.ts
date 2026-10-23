// 动态知识库层：与feimanstar-kb.ts静态框架层相对的"自动生长层"。
// 数据流：scripts/kb_grow.mjs（每日cron自动采集）→ data/kb_dynamic.json → route注入
// 设计原则：快照类条目必须带expires（数据会腐烂，30天强制过期）；
// 注入按关键词命中+新鲜度排序，不注入过期条目——KB永不过时是靠机制不是靠人工

import rawDynamic from "@/data/kb_dynamic.json";
import { readKbEntries, supabaseConfigured } from "@/lib/supabase";

export interface DynamicEntry {
  id: string;
  type: "data_snapshot" | "insight" | "gap";
  keywords: string[];
  content: string;
  source: string;
  created: string;
  expires?: string;
}

const raw = rawDynamic as { entries: DynamicEntry[] };

export async function selectDynamicKB(
  userText: string,
  maxChars = 4000
): Promise<{ block: string; count: number; latestCreated?: string; totalEntries?: number }> {
  try {
    const now = new Date().toISOString().slice(0, 10);
    const q = (userText || "").toLowerCase();
    // Supabase为主源（服务端cron持续写入），git json为兜底（DB未配置/查询失败时）
    let list: Array<{ id: string; type: string; keywords: string[]; content: string; source: string; created: string; expires?: string | null; sem?: boolean }> = [];
    if (supabaseConfigured()) {
      const rows = await readKbEntries(80);
      if (rows && rows.length > 0) {
        list = rows.map((r) => ({
          id: r.id, type: r.type, keywords: r.keywords || [],
          content: r.content, source: r.source, created: r.created,
          expires: r.expires ?? undefined,
        }));
      }
    }
    if (list.length === 0) list = raw.entries || [];
    // P2③语义检索合并：关键词命中（现有）+向量相似命中（pgvector），id去重
    try {
      const { embedTexts } = await import("@/lib/kb-embedding");
      const { matchKbSemantic } = await import("@/lib/supabase");
      if ((userText || "").length >= 6) {
        const qv = await embedTexts([userText.slice(0, 500)]);
        if (qv && qv[0]) {
          const semRows = await matchKbSemantic(qv[0], 12);
          if (semRows && semRows.length > 0) {
            const seenIds = new Set(list.map((e) => e.id));
            const seenSym = new Set<string>(); // 10/3：同标的日频快照只注入最相关一条——120条快照下近似条目会刷满语义候选
            for (const r of semRows) {
              if (!seenIds.has(r.id) && (!r.expires || r.expires >= now)) {
                // 10/3：机械结算记录不进对话知识块（content=机器JSON污染上下文）——
                // 证伪召回走settle-recall专用通道，kb_dynamic副本仅保留幂等账本职能
                if (r.source === "cron-judgment-settle") continue;
                const symMatch = r.type === "data_snapshot" ? ((r.content.match(/^(.+?)行情快照（/) || [])[1] || "") : "";
                if (symMatch) {
                  if (seenSym.has(symMatch)) continue;
                  seenSym.add(symMatch);
                }
                list.push({
                  id: r.id, type: r.type, keywords: r.keywords || [],
                  content: r.content, source: r.source, created: r.created,
                  expires: r.expires ?? undefined,
                  sem: true,
                });
                seenIds.add(r.id);
              }
            }
          }
        }
      }
    } catch {
      // 语义检索失败静默——关键词路由兜底
    }
    // 10/3增强：相关性加权排序（原纯时间排序——最新但弱相关的条目吃满注入预算，
    // 强相关的较早洞察被截断）。评分=语义命中3分（向量相似>0.75内）+每命中1个关键词2分；
    // 同分按新鲜度。快照条目keywords含标的名，问题提到该标的即命中。
    interface PickedEntry { id: string; type: string; keywords: string[]; content: string; source: string; created: string; expires?: string | null; sem: boolean; score: number }
    // 10/23件3（BM25第三通道）：专名/代码类query关键词标签漏+向量弱的补通道——零依赖纯计算
    const { bm25Search } = await import("@/lib/kb-bm25");
    const bm25Docs = list
      .filter((e) => !e.expires || e.expires >= now)
      .filter((e) => e.source !== "cron-judgment-settle")
      .map((e) => ({ id: e.id, text: e.content + "\n" + (e.keywords || []).join(" ") }));
    const bm25Hits = bm25Search(userText || "", bm25Docs);
    const bm25Top = bm25Hits.slice(0, 8);
    const bm25ScoreMap = new Map<string, number>();
    if (bm25Top.length > 0) {
      const topScore = bm25Top[0].score;
      for (const h of bm25Top) {
        // 归一化>0.25才有效命中（相对top1），防弱匹配噪声进上下文
        if (h.score / topScore >= 0.25) bm25ScoreMap.set(h.id, h.score);
      }
    }
    const picked: PickedEntry[] = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.expires && e.expires < now) continue;
      const kws = e.keywords || [];
      let kwHits = 0;
      for (let j = 0; j < kws.length; j++) {
        if (q.indexOf(kws[j].toLowerCase()) >= 0) kwHits += 1;
      }
      const sem = (e as { sem?: boolean }).sem === true;
      const bm25 = bm25ScoreMap.get(e.id) !== undefined;
      if (kwHits > 0 || sem || bm25) {
        // BM25=更聪明的关键词匹配，2分与关键词同级；语义3分保留
        picked.push({ ...e, sem, score: (sem ? 3 : 0) + kwHits * 2 + (bm25 ? 2 : 0) });
      }
    }
    picked.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.created < b.created ? 1 : -1;
    });
    const parts: string[] = [];
    let used = 0;
    for (let i = 0; i < picked.length && used < maxChars; i++) {
      parts.push("- " + picked[i].content);
      used += picked[i].content.length;
    }
    if (parts.length === 0) return { block: "", count: 0 };
    // 10/11 B1（GBrain缺口声明映射）：带出动态层元信息——chat组装"知识边界"声明用
    const latestCreated = list.reduce(function (m, e) { return e.created > m ? e.created : m; }, "");
    return {
      block:
        "\n\n【动态知识层（每日自动采集沉淀，引用时注明数据日期）】\n" +
        parts.join("\n"),
      count: parts.length,
      latestCreated: latestCreated || undefined,
      totalEntries: list.length,
    };
  } catch {
    return { block: "", count: 0 };
  }
}
