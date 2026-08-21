import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AIRequestError, callAI } from "@/lib/ai";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const requestSchema = z.object({
  period: z.enum(["week", "month"]),
  records: z.array(z.object({
    date: z.string().trim().min(1).max(50),
    trades: z.string().trim().min(1).max(8000),
    analysis: z.string().trim().max(8000).optional().default(""),
  })).min(1).max(31),
});

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "reviewSummary", RATE_LIMITS.reviewSummary);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const input = requestSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: "摘要参数不完整" }, { status: 400 });
  }

  const periodName = input.data.period === "week" ? "周报" : "月报";
  const recordsContent = input.data.records.map((record, index) => [
    `### 复盘记录${index + 1}（${record.date}）`,
    "交易记录：",
    record.trades,
    record.analysis ? `既有复盘结论：\n${record.analysis}` : "",
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");

  const systemPrompt = [
    "你是费曼星投资复盘分析师。以下是用户本周/本月的全部交易记录。",
    `请生成${periodName}，必须使用Markdown并包含：`,
    "1. 整体表现（胜率/盈亏比/总盈亏）",
    "2. 最佳交易和最差交易",
    "3. 行为偏差趋势",
    "4. 策略调整建议",
    "仅依据提供的数据计算；缺少买卖配对或盈亏信息时明确标注“数据不足”，禁止编造数字。",
    "建议必须具体、可执行，但不提供保证收益或具体买卖指令。",
    "末尾加：本摘要由AI生成，仅供研究参考，不构成投资建议。",
  ].join("\n");

  let summary: string | null;
  try {
    summary = await callAI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${periodName}原始资料：\n\n${recordsContent}` },
      ],
      { responseFormat: "text", temperature: 0.25, max_tokens: 3200, retry: 1, throwOnError: true },
    );
  } catch (error) {
    if (error instanceof AIRequestError && error.code === "timeout") {
      return NextResponse.json({ error: "AI摘要生成超时，请重试" }, { status: 504 });
    }
    return NextResponse.json({ error: "AI摘要服务暂时不可用" }, { status: 503 });
  }

  if (!summary) {
    return NextResponse.json({ error: "AI未返回有效摘要，请重试" }, { status: 503 });
  }

  return NextResponse.json(
    { data: { period: input.data.period, summary } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
