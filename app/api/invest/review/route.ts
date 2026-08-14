import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callAI } from "@/lib/ai";
import { loadKnowledgeBase } from "@/lib/knowledge";

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
    "你是一位专业的美股交易复盘分析师。根据用户提供的交易记录，做归因分析和策略评估。",
    "",
    "分析必须包含以下部分：",
    "",
    "## 1. 交易概览",
    "- 总笔数、盈利笔数/亏损笔数、胜率",
    "- 总盈亏金额、平均盈利、平均亏损",
    "- 盈亏比（平均盈利÷平均亏损，>1.5为健康）",
    "- 平均持仓周期（如能从记录推断）",
    "",
    "## 2. 盈亏归因",
    "- 盈利交易的共性：至少2个模式（如行业/市值/时间段/持仓周期）",
    "- 亏损交易的共性：至少2个模式",
    "- 如果样本太少（<3笔），明确说「样本不足，以下分析仅供参考」",
    "",
    "## 3. 策略评估",
    "- 如果用户描述了策略，评估策略有效性",
    "- 判断策略适用市场环境（趋势/震荡/高波动）",
    "- 如果未描述策略，从交易记录反推可能的策略逻辑",
    "",
    "## 4. 行为偏差检测",
    "- 逐笔检查是否存在以下偏差（具体到哪笔交易）：",
    "  - 处置效应（卖盈持亏）",
    "  - 损失厌恶（亏损加仓摊薄）",
    "  - 确认偏误（只看支持自己判断的证据）",
    "  - 锚定效应（被买入价锚定）",
    "  - 从众心理（追涨杀跌）",
    "- 如果未检测到偏差，明确说「未检测到明显行为偏差」",
    "",
    "## 5. 改进建议",
    "- 至少3条可执行建议",
    "- 每条必须具体（如「将止损线设在-5%而非-10%」，不是「控制风险」）",
    "- 按优先级排序（高/中/低）",
    "",
    "量化约束：",
    "- 每个结论必须引用具体交易数据支撑",
    "- 胜率/盈亏比等数字必须从用户给的记录计算，不编造",
    "- 如果记录格式混乱无法解析，明确说「记录格式不清晰，以下基于有限信息」",
    "",
    "安全约束：",
    "- 亏钱交易不做道德评价，只做归因",
    "- 不建议具体买卖操作",
    "- 末尾加「本分析由AI生成，仅供研究参考」",
  ].join("\n");

  const userContent = [
    "交易记录：",
    trades,
    "",
    strategy ? `使用的策略：${strategy}` : "",
    "",
    questions ? `特别想分析的问题：${questions}` : "",
    "",
    "费曼星投资知识库参考（模块5仓位策略+模块6行为偏差）：",
    loadKnowledgeBase().slice(0, 2000),
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
