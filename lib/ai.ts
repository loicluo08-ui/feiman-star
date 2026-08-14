import "server-only";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type VisionMessage = {
  role: "system" | "user" | "assistant";
  content: VisionContent;
};

export type VisionContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export type CallAIOptions = {
  temperature?: number;
  max_tokens?: number;
  retry?: number;
  timeout?: number;
  responseFormat?: "json" | "text";
  throwOnError?: boolean;
};

export class AIRequestError extends Error {
  code: "timeout" | "service_unavailable";

  constructor(code: "timeout" | "service_unavailable") {
    super(code === "timeout" ? "AI分析超时，请重试" : "AI服务暂时不可用");
    this.name = "AIRequestError";
    this.code = code;
  }
}

export function sanitizeInput(value: unknown, maxLength = 20_000): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function extractMessageContent(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const data = json as Record<string, unknown>;
  const choices = data.choices;
  if (!Array.isArray(choices) || !choices[0]) return null;
  const message = (choices[0] as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (!message) return null;
  const content = message.content;
  return typeof content === "string" ? content : null;
}

/**
 * 调用 DeepSeek（纯文字）
 */
export async function callAI(
  messages: ChatMessage[],
  options: CallAIOptions = {},
): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const maxRetries = options.retry ?? 1;
  let timedOut = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 90_000);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.max_tokens ?? 2_500,
          ...(options.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
        }),
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.ok) {
        const content = extractMessageContent(await response.json());
        if (content) return content;
      } else {
        console.error(`[ai] deepseek_status=${response.status} attempt=${attempt}`);
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          if (options.throwOnError) throw new AIRequestError("service_unavailable");
          return null;
        }
      }
    } catch (error) {
      if (error instanceof AIRequestError) throw error;
      const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "request_failed";
      if (reason === "timeout") timedOut = true;
      console.error(`[ai] ${reason} attempt=${attempt}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (options.throwOnError) {
    throw new AIRequestError(timedOut ? "timeout" : "service_unavailable");
  }
  return null;
}

/**
 * 调用智谱 GLM-4V（图片+文字）
 */
export async function callVisionAI(
  messages: VisionMessage[],
  options: CallAIOptions = {},
): Promise<string | null> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
  const maxRetries = options.retry ?? 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 45_000);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "glm-4v-plus-0111",
          messages,
          temperature: options.temperature ?? 0.4,
          max_tokens: options.max_tokens ?? 3_000,
        }),
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.ok) {
        const content = extractMessageContent(await response.json());
        if (content) return content;
      } else {
        console.error(`[ai] zhipu_status=${response.status} attempt=${attempt}`);
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return null;
        }
      }
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "request_failed";
      console.error(`[ai] zhipu_${reason} attempt=${attempt}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
}
