// KB动态层向量化管道：SiliconFlow BAAI/bge-large-zh-v1.5（1024维，免费）
// 10/3换模型实锤记录：原智谱embedding-2为收费模型，账户无资源包→HTTP 429错误码1113"余额不足"，
// 每轮growth向量化全部被拒且被三层静默catch吞掉→上线72h库存0向量（见output/ops_log/kb_semantic_audit_1003.md）。
// 换型理由：①SiliconFlow key已在生产env（chat降级链共用，零新增依赖）②bge-large-zh-v1.5免费且1024维与列定义对齐③条目均为短文本，512token上下文足够
// ⚠️向量空间变更纪律：2026-10-03起全库向量=bge-large-zh-v1.5空间。未来再换模型必须全库重算（旧向量与新查询向量跨空间不可比），不得混用。
// kb_dynamic.embedding列已启用（pgvector）；用途：语义检索（"英伟达估值"命中无字面关键词的PE条目）

const SILICONFLOW_KEY = process.env.SILICONFLOW_API_KEY || "";
const EMBED_URL = "https://api.siliconflow.cn/v1/embeddings";
const MODEL = "BAAI/bge-large-zh-v1.5"; // 免费，1024维

export function embeddingConfigured(): boolean {
  return !!SILICONFLOW_KEY;
}

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!SILICONFLOW_KEY || texts.length === 0) return null;
  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SILICONFLOW_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, input: texts }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      // 10/3教训：此处原为静默return null，嵌入API连续失败72h无人知晓——失败必须可观测
      const errBody = await res.text().catch(() => "");
      console.error(`[kb-embed] HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      return null;
    }
    const json = (await res.json()) as { data?: Array<{ embedding: number[]; index: number }> };
    if (!json.data || json.data.length !== texts.length) {
      console.error(`[kb-embed] 返回条数不匹配: 期望${texts.length} 实得${json.data?.length ?? 0}`);
      return null;
    }
    const ordered: number[][] = new Array(texts.length);
    for (const d of json.data) ordered[d.index] = d.embedding;
    return ordered;
  } catch (err) {
    console.error("[kb-embed] 请求异常:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
