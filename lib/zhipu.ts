import "server-only";

import { z } from "zod";

const embeddingResponseSchema = z.object({
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()).length(1024) })),
});

export class ZhipuConfigError extends Error {
  constructor() {
    super("智谱 embedding 服务尚未配置");
    this.name = "ZhipuConfigError";
  }
}

export async function createEmbeddings(input: string[]) {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new ZhipuConfigError();
  if (input.length === 0) return [];

  const baseUrl = (process.env.ZHIPU_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4").replace(/\/$/, "");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "embedding-2", input }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`[zhipu] upstream_status=${response.status}`);
      throw new Error("ZHIPU_UPSTREAM_ERROR");
    }

    const parsed = embeddingResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.data.length !== input.length) {
      throw new Error("ZHIPU_INVALID_RESPONSE");
    }
    return parsed.data.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function createEmbeddingsInBatches(input: string[], batchSize = 8) {
  const output: number[][] = [];
  for (let index = 0; index < input.length; index += batchSize) {
    output.push(...(await createEmbeddings(input.slice(index, index + batchSize))));
  }
  return output;
}
