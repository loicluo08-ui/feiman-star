import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callAI } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  trades: z.string().trim().min(10).max(8000),
  strategy: z.string().trim().max(2000).optional().default(""),
  questions: z.string().trim().max(1000).optional().default(""),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const input = requestSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  }

  const { trades, strategy, questions } = input.data;

  const systemPrompt = [
    "你是一位专业的交易复盘分析师。根据用户提供的交易记录，做归因分析和策略评估。",
    "",
    "分析必须包含以下部分：",
    "1. 交易概览：笔数、胜率、盈亏比、平均持仓周期",
    "2. 盈亏归因：赚钱的交易共性是什么？亏钱的交易共性是什么？",
    "3. 策略评估：如果用户描述了策略，评估策略有效性（顺势/逆势/震荡适用性）",
    "4. 行为偏差：发现的认知偏差（如损失厌恶、确认偏误、处置效应等），具体到哪笔交易",
    "5. 改进建议：至少3条可执行的改进建议，不要写"控制风险"这种废话",
    "",
    "规则：",
    "- 只基于用户给的数据分析，不编造",
    "- 亏钱交易不做道德评价，只做归因",
    "- 末尾加"本分析由AI生成，仅供研究参考"",
  ].join("\n");

  const userContent = [
    "交易记录：",
    trades,
    "",
    strategy ? `使用的策略：${strategy}` : "",
    "",
    questions ? `特别想分析的问题：${questions}` : "",
  ].join("\n");

  const answer = await callAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    { responseFormat: "text", temperature: 0.3, max_tokens: 3000, retry: 1 },
  );

  if (!answer) {
    return NextResponse.json({ error: "AI分析暂时不可用" }, { status: 503 });
  }

  return NextResponse.json(
    { data: { analysis: answer } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
