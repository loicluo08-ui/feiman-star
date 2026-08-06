import "server-only";

import { z, type ZodType } from "zod";
import { PublicApiError } from "@/lib/api-error";

const deepSeekResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable(),
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
});

type GenerateOptions<T> = {
  systemPrompt: string;
  outputSchema: ZodType<T>;
  maxTokens?: number;
};

export async function generateStructuredJson<T>({
  systemPrompt,
  outputSchema,
  maxTokens = 4_096,
}: GenerateOptions<T>): Promise<T> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new PublicApiError(503, "SERVICE_NOT_CONFIGURED", "生成服务尚未配置，请联系管理员。" );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(
      `${process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: "请严格执行以上任务，只输出一个合法的 JSON 对象。" },
          ],
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
          stream: false,
          temperature: 0.6,
          max_tokens: maxTokens,
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.error(`[deepseek] upstream_status=${response.status}`);
      if (response.status === 429) {
        throw new PublicApiError(429, "RATE_LIMITED", "生成请求较多，请稍后再试。" );
      }
      throw new PublicApiError(502, "UPSTREAM_ERROR", "生成服务暂时不可用，请稍后重试。" );
    }

    const upstream = deepSeekResponseSchema.safeParse(await response.json());
    if (!upstream.success) {
      console.error("[deepseek] invalid_response_shape");
      throw new PublicApiError(502, "INVALID_MODEL_RESPONSE", "生成结果格式异常，请重试。" );
    }

    const choice = upstream.data.choices[0];
    if (choice.finish_reason === "length") {
      throw new PublicApiError(502, "TRUNCATED_MODEL_RESPONSE", "生成内容被截断，请精简输入后重试。" );
    }

    if (!choice.message.content?.trim()) {
      throw new PublicApiError(502, "EMPTY_MODEL_RESPONSE", "模型未返回有效内容，请重试。" );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(choice.message.content);
    } catch {
      throw new PublicApiError(502, "INVALID_MODEL_JSON", "生成结果不是有效 JSON，请重试。" );
    }

    const validated = outputSchema.safeParse(parsedJson);
    if (!validated.success) {
      console.error("[deepseek] output_schema_mismatch");
      throw new PublicApiError(502, "MODEL_SCHEMA_MISMATCH", "生成结果字段不完整，请重试。" );
    }

    return validated.data;
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new PublicApiError(504, "UPSTREAM_TIMEOUT", "生成超时，请稍后重试。" );
    }
    console.error("[deepseek] request_failed");
    throw new PublicApiError(502, "UPSTREAM_UNREACHABLE", "暂时无法连接生成服务，请稍后重试。" );
  } finally {
    clearTimeout(timeout);
  }
}
