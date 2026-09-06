import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callAI, type ChatMessage } from "@/lib/ai";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 长对话滚动摘要（9/6）：对话窗口外的消息压缩成分析上下文记忆
// 前端在窗口溢出≥4条时调用（fire-and-forget，不阻塞发送），摘要作为独立user消息回插payload头部
// 失败静默降级：前端拿不到新摘要就继续用旧摘要/无摘要

const msgSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(4000),
});

const requestSchema = z.object({
  prevSummary: z.string().max(2000).optional().default(""),
  messages: z.array(msgSchema).min(1).max(8),
});

const SUMMARY_PROMPT = [
  "你是投资对话记忆压缩引擎。把以下对话增量压缩进已有摘要，产出新的分析上下文摘要。",
  "",
  "必须逐字保留（这是摘要的全部价值）：",
  "- 所有具体数字：成本价/现价/仓位/股数/盈亏额/百分比/资金量/价格位",
  "- 用户持有的标的、用户立场（看多/看空/持有观察）、用户陈述的约束（资金量/风险偏好/时间窗口）",
  "- AI给出过的关键结论、条件位（站稳X/跌破Y）、分歧点",
  "",
  "必须丢弃：寒暄、过程展开、重复内容、未涉及数字的泛泛讨论",
  "输出：≤400字纯文本，无标题无markdown格式。数字禁止改写换算。",
].join("\n");

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "chat", RATE_LIMITS.chat);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }

  // 只取原文前600字/条——摘要要的是骨架不是全文（数字和立场才是记忆）
  const transcript = input.messages
    .map((m) => `${m.role === "user" ? "用户" : "AI"}: ${m.text.slice(0, 600)}`)
    .join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SUMMARY_PROMPT },
    {
      role: "user",
      content: [
        input.prevSummary ? `[已有摘要（新内容合并进来，冲突以新内容为准）]\n${input.prevSummary}` : "",
        `[新增对话]\n${transcript}`,
        "请输出合并后的新摘要。",
      ].filter(Boolean).join("\n\n"),
    },
  ];

  try {
    const summary = await callAI(messages, {
      temperature: 0.2, // 压缩是保真任务，低温度
      max_tokens: 500,
      timeout: 20_000,
    });

    if (!summary || !summary.trim()) {
      return NextResponse.json({ error: "摘要引擎无响应" }, { status: 503 });
    }

    return NextResponse.json(
      { summary: summary.trim().slice(0, 2000) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "摘要失败" }, { status: 503 });
  }
}
