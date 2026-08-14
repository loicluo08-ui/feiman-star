import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callAI } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  stockName: z.string().trim().min(1).max(50),
  stockCode: z.string().trim().min(1).max(10),
  marketData: z.string().trim().min(1).max(8000),
  userNotes: z.string().trim().max(2000).optional().default(""),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const input = requestSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  }

  const { stockName, stockCode, marketData, userNotes } = input.data;

  const systemPrompt = [
    "你是一位资深A股分析师。根据提供的实时行情和财务数据，生成结构化的选股分析报告。",
    "",
    "分析必须包含以下部分：",
    "1. 基本面概况：市值、PE、PB、ROE，与行业均值对比",
    "2. 技术面分析：当前价格位置、量价关系、关键支撑/压力位",
    "3. 财务健康度：营收增速、利润率、资产负债率、现金流状况",
    "4. 风险提示：至少3条具体风险（不要写"股市有风险"这种废话）",
    "5. 综合评估：给出3个维度的评分（基本面/技术面/估值）各1-10分，附一句话理由",
    "",
    "规则：",
    "- 数据只能引用用户提供的市场数据，不要编造数字",
    "- 如果数据不完整，明确说"数据缺失"而不是猜",
    "- 不给出买卖建议，只做分析",
    "- 末尾加"本分析由AI生成，仅供研究参考，不构成投资建议"",
  ].join("\n");

  const userContent = [
    `股票：${stockName}（${stockCode}）`,
    "",
    "市场数据：",
    marketData,
    "",
    userNotes ? `用户补充：${userNotes}` : "",
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
