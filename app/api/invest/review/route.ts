import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AIRequestError, callAI } from "@/lib/ai";
import { loadKnowledgeBase } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    "## 📋 交易概览",
    "用表格展示：",
    "| 指标 | 数值 | 判断 |",
    "|------|------|------|",
    "| 总笔数 | x | — |",
    "| 胜率 | x% | 高(>50%)/低(<50%) |",
    "| 盈亏比 | x | 健康(>1.5)/不健康(<1.5) |",
    "| 总盈亏 | $x | — |",
    "| 平均持仓 | x天 | — |",
    "",
    "## 🔍 盈亏归因",
    "| | 共性模式 | 具体表现 |",
    "|---|---------|---------|",
    "| ✅ 盈利交易 | 模式1 | ... |",
    "| ✅ 盈利交易 | 模式2 | ... |",
    "| ❌ 亏损交易 | 模式1 | ... |",
    "| ❌ 亏损交易 | 模式2 | ... |",
    "（样本<3笔时标注「样本不足」）",
    "",
    "## 3. 策略评估",
    "- 如果用户描述了策略，评估策略有效性",
    "- 判断策略适用市场环境（趋势/震荡/高波动）",
    "- 如果未描述策略，从交易记录反推可能的策略逻辑",
    "",
    "## 🧠 行为偏差检测",
    "| 偏差类型 | 检测结果 | 涉及交易 |",
    "|---------|---------|---------|",
    "| 处置效应 | ✅发现/❌未发现 | 第x笔 |",
    "| 损失厌恶 | ✅/❌ | ... |",
    "| 确认偏误 | ✅/❌ | ... |",
    "| 锚定效应 | ✅/❌ | ... |",
    "| 从众心理 | ✅/❌ | ... |",
    "",
    "## ✅ 改进建议（按优先级排序）",
    "| 优先级 | 建议 | 预期效果 |",
    "|--------|------|---------|",
    "| 🔴 高 | [具体可执行] | [效果] |",
    "| 🟡 中 | ... | ... |",
    "| 🟢 低 | ... | ... |",
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

  let answer: string | null;
  try {
    answer = await callAI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      { responseFormat: "text", temperature: 0.3, max_tokens: 3000, retry: 1, throwOnError: true },
    );
  } catch (error) {
    if (error instanceof AIRequestError && error.code === "timeout") {
      return NextResponse.json({ error: "AI分析超时，请重试" }, { status: 504 });
    }
    return NextResponse.json({ error: "DeepSeek服务暂时不可用，请稍后重试" }, { status: 503 });
  }

  if (!answer) {
    return NextResponse.json({ error: "DeepSeek未返回有效内容，请重试" }, { status: 503 });
  }

  return NextResponse.json(
    { data: { analysis: answer } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
