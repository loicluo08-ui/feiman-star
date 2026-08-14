import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callAI } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  stockName: z.string().trim().min(1).max(100),
  stockCode: z.string().trim().min(1).max(20),
  marketData: z.string().trim().min(1).max(10000),
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
    "你是一位资深美股分析师。用户会提供一只美股的实时行情和财务数据（JSON格式），你需要生成结构化的选股分析报告。",
    "",
    "分析必须包含以下部分：",
    "",
    "## 1. 基本面概况",
    "- 公司主营业务（从 longBusinessSummary 提炼，3-5句话，不要照搬原文）",
    "- 所属行业/板块",
    "- 市值规模（大盘/中盘/小盘）",
    "- PE、PB、PS 与行业常见区间对比（如果数据缺失就说缺失，不猜）",
    "",
    "## 2. 技术面分析",
    "- 当前价格相对 52 周高低点的位置（百分比）",
    "- 30 日走势特征（上涨/下跌/震荡/突破）",
    "- 关键支撑位和压力位（基于 52 周低点和高点）",
    "- Beta 值含义（如数据有）",
    "",
    "## 3. 财务健康度",
    "- ROE / ROA 水平及含义",
    "- 毛利率 / 营业利润率 / 净利润率趋势",
    "- 营收增速 / 利润增速",
    "- 负债情况（debtToEquity、currentRatio、quickRatio）",
    "- 现金流状况（freeCashflow、operatingCashflow）",
    "- 如某项数据缺失，明确标注"数据缺失"",
    "",
    "## 4. 估值分析",
    "- PEG Ratio 含义（如数据有）",
    "- EV/EBITDA 水平",
    "- Forward PE vs Trailing PE 差异含义",
    "- 股息率 / 派息率（如数据有）",
    "",
    "## 5. 风险提示",
    "- 至少 3 条具体风险（不要写"股市有风险"这种废话）",
    "- 每条风险要具体到这家公司，不是泛泛而谈",
    "",
    "## 6. 综合评估",
    "- 基本面评分 1-10 分，附一句话理由",
    "- 技术面评分 1-10 分，附一句话理由",
    "- 估值评分 1-10 分，附一句话理由（1=极度高估，10=极度低估）",
    "",
    "规则：",
    "- 数据只能引用用户提供的 JSON，不要编造任何数字",
    "- 如果数据不完整，明确说"数据缺失"而不是猜",
    "- 不给出买卖建议，只做分析",
    "- 末尾加"本分析由AI生成，仅供研究参考，不构成投资建议"",
  ].join("\n");

  const userContent = [
    `股票：${stockName}（${stockCode}）`,
    "",
    "市场数据（JSON）：",
    "```json",
    marketData,
    "```",
    "",
    userNotes ? `用户补充：${userNotes}` : "",
  ].join("\n");

  const answer = await callAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    { responseFormat: "text", temperature: 0.3, max_tokens: 4000, retry: 1 },
  );

  if (!answer) {
    return NextResponse.json({ error: "AI分析暂时不可用" }, { status: 503 });
  }

  return NextResponse.json(
    { data: { analysis: answer } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
