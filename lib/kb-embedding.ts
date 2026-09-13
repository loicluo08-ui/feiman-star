// KB动态层向量化管道（P2③起步）：智谱embedding-2（1024维）——
// kb_dynamic.embedding列已预留（pgvector已启用）
// 用途：语义检索替代关键词正则路由（"英伟达估值"能命中"NVDAPE分位"类条目）
// 阶段：本文件先提供生成函数+cron采集后向量化入口；查询侧语义检索下一步接

const ZHIPU_KEY = process.env.ZHIPU_API_KEY || "";
const EMBED_URL = "https://open.bigmodel.cn/api/paas/v4/embeddings";
const MODEL = "embedding-2"; // 1024维

export function embeddingConfigured(): boolean {
  return !!ZHIPU_KEY;
}

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!ZHIPU_KEY || texts.length === 0) return null;
  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ZHIPU_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, input: texts }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ embedding: number[]; index: number }> };
    if (!json.data || json.data.length !== texts.length) return null;
    const ordered: number[][] = new Array(texts.length);
    for (const d of json.data) ordered[d.index] = d.embedding;
    return ordered;
  } catch {
    return null;
  }
}
