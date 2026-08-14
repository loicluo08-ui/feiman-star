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
    "- 公司主营业务（3-5句话提炼，不要照搬原文）",
    "- 所属行业/板块",
    "- 市值规模分类：大盘（>10B）/中盘（2B-10B）/小盘（<2B）",
    "- PE、PB、PS 与行业常见区间对比",
    "",
    "## 2. 技术面分析",
    "- 当前价格相对52周高低点的位置百分比",
    "- 30日走势特征（上涨/下跌/震荡/突破，用具体数字支撑）",
    "- 关键支撑位和压力位（基于52周低点和高点）",
    "- Beta值含义（>1高波动，<1低波动）",
    "",
    "## 3. 财务健康度",
    "- ROE/ROA水平（>15%优秀，<5%偏弱，数据缺失就说缺失）",
    "- 毛利率/营业利润率/净利润率趋势",
    "- 营收增速/利润增速（双位数增长标注"高增长"）",
    "- 负债情况：debtToEquity（>2偏高，<0.5保守）、currentRatio（>2充足，<1紧张）",
    "- 现金流：freeCashflow为正且增长=健康，为负要说明原因",
    "",
    "## 4. 估值分析",
    "- PEG Ratio（<1可能低估，>2可能高估，数据缺失就说缺失）",
    "- EV/EBITDA水平（与行业对比）",
    "- Forward PE vs Trailing PE差异（Forward更低=市场预期增长）",
    "- 股息率/派息率（>4%高股息，<1%成长型）",
    "",
    "## 5. 风险提示",
    "- 至少3条具体风险，每条必须具体到这家公司",
    "- 风险类型至少覆盖：业务风险/财务风险/估值风险",
    "- 禁止写"股市有风险""投资需谨慎"等废话",
    "",
    "## 6. 综合评估",
    "- 基本面评分1-10分（附一句话理由）",
    "- 技术面评分1-10分（附一句话理由）",
    "- 估值评分1-10分（1=极度高估，5=合理，10=极度低估）",
    "- 三项加权总分（基本面40%+技术面30%+估值30%）",
    "",
    "量化约束：",
    "- 每个判断必须引用具体数字支撑，不允许"较高""较好"等模糊表述",
    "- 如果数据缺失，写"数据缺失"，不猜不编",
    "- 行业对比要有具体基准值（如"科技行业平均PE约25-35"）",
    "",
    "安全约束：",
    "- 不给出买卖建议（买入/卖出/持有），只做分析",
    "- 不预测未来价格走势",
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
