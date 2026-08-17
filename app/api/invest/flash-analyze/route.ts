import { NextRequest } from "next/server";
import { FLASH_KB } from "@/lib/flash-kb";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "flash-analyze", { maxRequests: 10, windowMs: 60_000 });
  if (limited) {
    return new Response(
      JSON.stringify({ error: `请求过于频繁，请${limited.retryAfter}秒后重试` }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(limited.retryAfter) } },
    );
  }

  if (!DEEPSEEK_KEY) {
    return new Response(
      JSON.stringify({ error: "AI分析未配置" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "请求格式错误" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { content, title, source } = body as { content: string; title?: string; source?: string };

  if (!content || typeof content !== "string" || content.length < 5) {
    return new Response(
      JSON.stringify({ error: "内容过短，无法分析" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const systemPrompt = `你是费曼星投资分析助手。用户会给你一条财经快讯，你需要快速分析这条消息对QQQ（纳斯达克100 ETF）的影响。

分析格式：
1. 一句话总结这条消息的核心内容
2. 对QQQ的影响方向（利好/利空/中性）和逻辑
3. 对纳斯达克100成分股的主要影响（科技股/消费/医疗等板块）
4. QQQ投资者需要关注什么

要求：
- 简洁，300字以内
- 直接给判断，不要说"需要进一步观察"
- 如果消息跟QQQ/纳斯达克100关联度低，直接说"此消息对QQQ影响有限"
- 用中文回复

<knowledge_base>
${FLASH_KB}
</knowledge_base>`;

  const userPrompt = `快讯来源：${source || "未知"}
标题：${title || "无标题"}
内容：${content}

请结合知识库中的QQQ分析框架，分析这条快讯对QQQ的影响。`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch(DEEPSEEK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${DEEPSEEK_KEY}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: true,
            max_tokens: 800,
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          controller.enqueue(encoder.encode(`分析失败：AI服务异常（${response.status}）`));
          controller.close();
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode("分析失败：无响应流"));
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              // 跳过不完整的JSON
            }
          }
        }

        controller.close();
      } catch (error: any) {
        if (error.name === "AbortError" || error.name === "TimeoutError") {
          controller.enqueue(encoder.encode("\n\n（分析超时）"));
        } else {
          controller.enqueue(encoder.encode(`\n\n分析出错：${error.message || "未知错误"}`));
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
