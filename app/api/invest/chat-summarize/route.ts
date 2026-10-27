import { NextRequest, NextResponse } from "next/server";
import { gateCheck } from "@/lib/gate";
import { z } from "zod";
import { callAI, type ChatMessage } from "@/lib/ai";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { upsertChatSession, readChatSession } from "@/lib/supabase";

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
  // 10/27 dsh对照P1：会话摘要真源服务端化——客户端生成uuid随请求带上，服务端落库可回放
  sessionId: z.string().min(8).max(64).regex(/^[a-zA-Z0-9-]+$/).optional(),
  // 累计已压缩消息数（shadowed记账，对齐dsh compaction/summary的shadowedSeqs思想）
  shadowedCount: z.number().int().min(0).max(10000).optional(),
});

const SUMMARY_PROMPT = [
  "你是投资对话记忆压缩引擎。把以下对话增量压缩进已有摘要，产出新的分析上下文摘要。",
  "",
  "必须逐字保留（这是摘要的全部价值）：",
  "- 所有具体数字：成本价/现价/仓位/股数/盈亏额/百分比/资金量/价格位",
  "- 用户持有的标的、用户立场（看多/看空/持有观察）、用户陈述的约束（资金量/风险偏好/时间窗口）",
  "- AI给出过的关键结论、条件位（站稳X/跌破Y）、分歧点",
  "- AI给过的行动计划档位：目标仓位%/分笔分配/触发条件（若回踩$X…则加仓…）/证伪信号——计划的生命周期跨越轮次，摘要丢了计划=用户回访时AI失忆重新分析",
  "",
  "必须丢弃：寒暄、过程展开、重复内容、未涉及数字的泛泛讨论",
  "输出：≤400字纯文本，无标题无markdown格式。数字禁止改写换算。",
].join("\n");

export async function POST(request: NextRequest) {
  // 10/3审计P0：AI消费口令闸（独立env=FX_AI_GATE_TOKEN：10/4逸翔令访问口令对公众去除——此env线上不配置=免口令放行，限流兜底；写路径仍走FX_GATE_TOKEN保持fail-closed）
  const gated = gateCheck(request, "FX_AI_GATE_TOKEN", "open_until_configured");
  if (gated) return gated;
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

  // 首部400+尾部400拼接（原截前600字会切掉回答尾部的【裁决】+行动计划段——
  // 计划档位是摘要必保项却在消息尾部，尾部必须进摘要窗口）
  const transcript = input.messages
    .map((m) => {
      const t = m.text.length > 800
        ? `${m.text.slice(0, 400)}\n[中段省略]\n${m.text.slice(-400)}`
        : m.text;
      return `${m.role === "user" ? "用户" : "AI"}: ${t}`;
    })
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

    const clean = summary.trim().slice(0, 2000);

    // 真源落库（10/27 dsh对照P1）：await而非fire-and-forget——Vercel serverless响应返回后
    // 后台任务可能被冻结，void调用=落库静默丢失（恰是本修复要消灭的失效模式）。
    // 落库失败不阻塞返回（客户端摘要照常用，下次触发重写=自愈）。
    if (input.sessionId) {
      try {
        await upsertChatSession(input.sessionId, clean, input.shadowedCount ?? 0, transcript.length);
      } catch {
        // 静默：摘要服务照常，真源下次触发重写
      }
    }

    return NextResponse.json(
      { summary: clean },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "摘要失败" }, { status: 503 });
  }
}

// 10/27 dsh对照P1：会话摘要兜底读——客户端localStorage爆容/换设备/清缓存后，
// 凭sessionId从服务端拉回最新摘要（对齐dsh"日志为唯一真源"：本地副本只是缓存）
export async function GET(request: NextRequest) {
  const gated = gateCheck(request, "FX_AI_GATE_TOKEN", "open_until_configured");
  if (gated) return gated;
  const limited = await enforceRateLimitAsync(request, "chat", RATE_LIMITS.chat);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }
  const sessionId = request.nextUrl.searchParams.get("sessionId") || "";
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(sessionId)) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const row = await readChatSession(sessionId);
  return NextResponse.json(
    { summary: row?.summary ?? null, shadowedCount: row?.shadowedCount ?? 0, ts: row?.ts ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
