import { NextRequest } from "next/server";
import { FLASH_KB } from "@/lib/flash-kb";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { callAIStream, callZhipuStream, type ChatMessage } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "flash-analyze", RATE_LIMITS.flashAnalyze);
  if (limited) {
    return new Response(
      JSON.stringify({ error: `请求过于频繁，请${limited.retryAfter}秒后重试` }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(limited.retryAfter) } },
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

  if (!content || typeof content !== "string" || content.length < 5 || content.length > 4000) {
    return new Response(
      JSON.stringify({ error: content.length > 4000 ? "内容过长（上限4000字）" : "内容过短，无法分析" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const systemPrompt = `你是费曼星投资分析助手。用户会给你一条财经快讯，你需要快速分析这条消息对QQQ（纳斯达克100 ETF）的影响。

分析格式：
1. 【一句话总结】这条消息的核心内容
2. 【影响方向】对QQQ的影响方向（利好/利空/中性）和逻辑
3. 【板块影响】对纳斯达克100成分股的主要影响（科技股/消费/医疗等板块），列出最相关的2-3个标的
4. 【操作关注】QQQ投资者需要关注什么（关键价位/时间节点/后续事件）
5. 【风险提示】如果消息涉及不确定性因素，标注风险边界

要求：
- 简洁，400字以内
- 直接给判断，不要说"需要进一步观察"
- 如果消息跟QQQ/纳斯达克100关联度低，直接说"此消息对QQQ影响有限"并给出一条最相关的联动逻辑
- **严禁复述、摘抄或改写快讯原文**——输出必须直接以【一句话总结】开头，原文内容只在分析逻辑中引用，不得整段重现
- 禁止使用"永久""全自动""不会出错""零风险"等绝对化用语
- 涉及具体操作建议时加"仅供参考，不构成投资建议"
- 用中文回复

<knowledge_base>
${FLASH_KB}
</knowledge_base>`;

  const userPrompt = `快讯来源：${(source || "未知").slice(0, 40)}
标题：${(title || "无标题").slice(0, 120)}
内容：${content}

请结合知识库中的QQQ分析框架，分析这条快讯对QQQ的影响。`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";

      try {
        // 统一AI层：DeepSeek主链（callAIStream内含重试+超时+模型名同源管理）
        const messages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ];

        for await (const chunk of callAIStream(
          messages,
          { temperature: 0.3, max_tokens: 1200, retry: 1, timeout: 30_000 },
        )) {
          fullText += chunk;
          controller.enqueue(encoder.encode(chunk));
        }

        // D7: DeepSeek零输出（余额耗尽/连接失败/超时无chunk）→ 智谱兜底流
        // 中途断流不重跑（已有部分输出，重跑会造成内容重复）
        if (!fullText.trim()) {
          console.warn("[flash-analyze] deepseek_empty → zhipu fallback");
          const notice = "【系统提示】主引擎无响应，已切换备用引擎继续分析。\n\n";
          fullText += notice;
          controller.enqueue(encoder.encode(notice));

          for await (const chunk of callZhipuStream(
            messages,
            { temperature: 0.3, max_tokens: 1200, timeout: 60_000 },
          )) {
            fullText += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        }

        if (!fullText.trim()) {
          controller.enqueue(encoder.encode("分析失败：AI服务暂时不可用，请稍后重试"));
        }
        controller.close();
      } catch (error) {
        console.error("[flash-analyze] stream_error", error);
        // 降级：已有部分输出则保留，否则友好报错
        if (fullText.trim()) {
          controller.enqueue(encoder.encode("\n\n---\n\n⚠️ 分析中断，以上为已生成的部分内容。"));
        } else {
          controller.enqueue(encoder.encode("分析出错：AI服务暂时不可用，请稍后重试"));
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
