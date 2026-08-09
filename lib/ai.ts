import "server-only";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CallAIOptions = {
  temperature?: number;
  max_tokens?: number;
  retry?: number;
  timeout?: number;
  responseFormat?: "json" | "text";
};

export type SanitizeResult =
  | { ok: true; text: string }
  | { ok: false; text?: undefined };

export function sanitizeInput(value: unknown, maxLength = 20_000): SanitizeResult {
  if (typeof value !== "string") return { ok: false };

  const text = value
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();

  if (!text || text.length > maxLength) return { ok: false };
  return { ok: true, text };
}

function extractMessageContent(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

export async function callAI(
  messages: ChatMessage[],
  options: CallAIOptions = {},
): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || messages.length === 0) return null;

  const attempts = Math.max(1, Math.min((options.retry ?? 0) + 1, 3));
  const timeoutMs = Math.max(1_000, Math.min(options.timeout ?? 45_000, 90_000));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
            messages,
            ...(options.responseFormat === "text"
              ? {}
              : { response_format: { type: "json_object" } }),
            thinking: { type: "disabled" },
            stream: false,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens ?? 2_500,
          }),
          cache: "no-store",
          signal: controller.signal,
        },
      );

      if (response.ok) {
        const content = extractMessageContent(await response.json());
        if (content) return content;
      } else {
        console.error(`[ai] deepseek_status=${response.status} attempt=${attempt}`);
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return null;
        }
      }
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "request_failed";
      console.error(`[ai] ${reason} attempt=${attempt}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
}
