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

// ── 9/6红队修复：per-instance AI日预算（KV全局限流未激活前的第三层钱包防线） ──
// 单实例内计数；多实例会放大上限（N×budget），真正的全局上限=DeepSeek余额+KV限流（待绑定）
// 默认1500次/日/实例：约为单人正常日用量10倍，攻击者在单实例上的烧钱被截断
const AI_DAILY_BUDGET = Math.max(1, Number(process.env.AI_DAILY_BUDGET ?? 1500));
let budgetDay = "";
let budgetUsed = 0;

function consumeAIBudget(tag: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== budgetDay) {
    budgetDay = today;
    budgetUsed = 0;
  }
  if (budgetUsed >= AI_DAILY_BUDGET) {
    console.warn(`[ai-budget] ${tag} blocked: ${budgetUsed}/${AI_DAILY_BUDGET} (instance-local, resets daily)`);
    return false;
  }
  budgetUsed += 1;
  return true;
}

export function getAIBudgetStatus(): { used: number; limit: number; day: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== budgetDay) return { used: 0, limit: AI_DAILY_BUDGET, day: today };
  return { used: budgetUsed, limit: AI_DAILY_BUDGET, day: budgetDay };
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
  const apiKey = process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) return null;
  if (!consumeAIBudget("callAI")) return null;

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
  options: CallAIOptions & { signal?: AbortSignal } = {},
): Promise<string | null> {
  const apiKey = process.env.ZHIPU_API_KEY || "";
  if (!apiKey) return null;
  if (!consumeAIBudget("callVisionAI")) return null;

  const baseUrl = process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
  const maxRetries = options.retry ?? 1;
  const externalSignal = options.signal;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 外部signal联动（与流式引擎同语义）：客户端断开→中止上游请求，不白烧
    if (externalSignal?.aborted) return null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 45_000);
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.ZHIPU_VISION_MODEL || "glm-4v-flash",
          messages,
          temperature: options.temperature ?? 0.4,
          // glm-4v-flash免费版max_tokens硬上限1024，超限报400码1210
          max_tokens: Math.min(options.max_tokens ?? 1024, 1024),
        }),
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.ok) {
        const content = extractMessageContent(await response.json());
        if (content) return content;
      } else {
        const errBody = await response.text().catch(() => "");
        console.error(
          `[ai] zhipu_status=${response.status} attempt=${attempt} body=${errBody.slice(0, 200)}`,
        );
        // 透传最后一次失败原因给调用方（诊断503根因：402欠费/429限流/401权限/500服务端）
        (globalThis as Record<string, unknown>).__lastZhipuError =
          `zhipu_${response.status}: ${errBody.slice(0, 120)}`;
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return null;
        }
      }
    } catch (error) {
      // 用户主动断开→直接放弃（不重试），区别于超时/失败
      if (externalSignal?.aborted) return null;
      const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "request_failed";
      console.error(`[ai] zhipu_${reason} attempt=${attempt}`);
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  return null;
}

/**
 * 流式调用智谱 GLM 文本模型（DeepSeek 失败时的兜底引擎）。
 * 智谱 chat/completions 兼容 OpenAI SSE 格式。
 * signal：客户端断开时中止上游连接（与callAIStream同语义——停止生成=停止烧钱）。
 */
export async function* callZhipuStream(
  messages: ChatMessage[],
  options: CallAIOptions & { signal?: AbortSignal } = {},
): AsyncGenerator<StreamChunk> {
  const apiKey = process.env.ZHIPU_API_KEY || "";
  if (!apiKey || messages.length === 0) return;
  if (!consumeAIBudget("callZhipuStream")) return;

  const baseUrl = process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
  const model = process.env.ZHIPU_TEXT_MODEL || "glm-4-flash";
  const timeoutMs = Math.max(1_000, Math.min(options.timeout ?? 60_000, 90_000));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: options.temperature ?? 0.5,
        max_tokens: options.max_tokens ?? 3_000,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      console.error(`[ai-stream] zhipu_status=${response.status}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { kind: "text", text: delta };
          // finish_reason=length：max_tokens截断（chat页需要向用户明示）
          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason) yield { kind: "finish", reason: finishReason };
        } catch {
          // 跳过格式异常的 chunk
        }
      }
    }
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? externalSignal?.aborted ? "user_abort" : "timeout"
        : "stream_failed";
    console.error(`[ai-stream] zhipu_${reason}`);
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * 流式调用 DeepSeek，逐 chunk yield。
 */
export type StreamChunk =
  | { kind: "text"; text: string }
  | { kind: "finish"; reason: "stop" | "length" | string };

export async function* callAIStream(
  messages: ChatMessage[],
  options: CallAIOptions & { signal?: AbortSignal } = {},
): AsyncGenerator<StreamChunk> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || messages.length === 0) return;
  if (!consumeAIBudget("callAIStream")) return;

  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const timeoutMs = Math.max(1_000, Math.min(options.timeout ?? 60_000, 90_000));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  // 用户点"停止生成"→外部signal联动内部controller，中止上游DeepSeek连接=停止生成停止烧钱
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        thinking: { type: "disabled" },
        temperature: options.temperature ?? 0.5,
        max_tokens: options.max_tokens ?? 3_000,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      console.error(`[ai-stream] deepseek_status=${response.status}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { kind: "text", text: delta };
          // finish_reason=length：max_tokens截断（chat页需要向用户明示）
          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason) yield { kind: "finish", reason: finishReason };
        } catch {
          // 跳过格式异常的 chunk
        }
      }
    }
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? externalSignal?.aborted ? "user_abort" : "timeout"
        : "stream_failed";
    console.error(`[ai-stream] ${reason}`);
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
