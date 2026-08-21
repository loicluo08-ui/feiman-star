import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AIRequestError, callAIStream } from "@/lib/ai";
import { crossValidate } from "@/lib/cross-validate";
import { loadKnowledgeBase } from "@/lib/knowledge";
import { FEIMANSTAR_KB } from "@/lib/feimanstar-kb";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const requestSchema = z.object({
  trades: z.string().trim().min(10).max(8000),
  strategy: z.string().trim().max(2000).optional().default(""),
  questions: z.string().trim().max(1000).optional().default(""),
  totalCapital: z.coerce.number().positive().max(1_000_000_000).optional().default(100_000),
});

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "review", RATE_LIMITS.review);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const input = requestSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  }

  const { trades, strategy, questions, totalCapital } = input.data;

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
    "## 📊 策略评估",
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
    "## ⚠️ 仓位规则检查",
    `用户总资金：$${totalCapital.toLocaleString("en-US")}`,
    "请逐笔检查并用表格列出：交易序号、代码、交易金额、占总资金比例、结论。规则：",
    "- 单笔交易不超过总资金的15%",
    "- 期权操作资金不超过总资金的5%",
    "- 日内期权仓位不超过可操作资金的20%（可操作资金按总资金的5%计算）",
    "- 如有违规，逐笔标注⚠️违规；无法从记录确认期权张数、合约乘数或日内属性时，明确标注“信息不足，需人工确认”，禁止猜测",
    "",
    "量化约束：",
    "- 每个结论必须引用具体交易数据支撑",
    "- 胜率/盈亏比等数字必须从用户给的记录计算，不编造",
    "- 未平仓仓位（有买入无对应卖出）：只用用户记录中的成交价计算已实现成本，浮盈浮亏需用户提供当前价才可计算；用户未提供当前价时标注「需提供当前市价」，禁止用你记忆中的价格估算",
    "- 如果记录格式混乱无法解析，明确说「记录格式不清晰，以下基于有限信息」",
    "",
    "安全约束：",
    "- 亏钱交易不做道德评价，只做归因",
    "- 不建议具体买卖操作",
    "- 末尾加「本分析由AI生成，仅供研究参考」",
    "",
    "## 输出前内部交叉验证（不输出验证过程，只输出最终通过验证的回答）",
    "a. 事实核查：每个结论必须从用户给的交易记录计算，不编造数字。",
    "b. 逻辑一致性：前后论述不能自相矛盾。",
    "c. 绝对化用语清除：禁止「永久」「全自动」「不会出错」「百分之百」「零风险」「保证不会」「完全安全」。",
    "d. 边界标明：样本不足时标注，高风险话题加「仅供参考」。",
    "e. 反追问测试：确保没有答不上来的声称。",
  ].join("\n");

  const userContent = [
    "交易记录：",
    trades,
    "",
    `总资金：$${totalCapital.toLocaleString("en-US")}`,
    "",
    strategy ? `使用的策略：${strategy}` : "",
    "",
    questions ? `特别想分析的问题：${questions}` : "",
    "",
    "费曼星投资知识库参考（模块5仓位策略+模块6行为偏差）：",
    loadKnowledgeBase().slice(0, 2000),
    "",
    "<knowledge_base>",
    FEIMANSTAR_KB,
    "</knowledge_base>",
  ].join("\n");

  let fullText = "";
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const aiStream = callAIStream(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          { temperature: 0.3, max_tokens: 4000, timeout: 60_000 },
        );

        for await (const chunk of aiStream) {
          fullText += chunk;
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "chunk", text: chunk }) + "\n"),
          );
        }

        if (!fullText.trim()) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", message: "DeepSeek未返回有效内容，请重试" }) + "\n"),
          );
          return;
        }

        const validation = crossValidate(fullText);
        if (validation.cleaned) {
          console.log(`[invest/review] cross_validate flags=${validation.flags.join("; ")}`);
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "patch", text: validation.text }) + "\n"),
          );
        }

        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "done" }) + "\n"),
        );
      } catch (error) {
        console.error("[invest/review] stream_error", error);
        if (fullText.trim()) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "chunk", text: "\n\n---\n\n⚠️ AI生成中断，以上为已生成的部分内容。如需完整分析请重试。" }) + "\n"),
          );
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "done" }) + "\n"),
          );
        } else {
          const message = error instanceof AIRequestError
            ? (error.code === "timeout" ? "AI分析超时，请重试" : "DeepSeek服务暂时不可用")
            : "AI服务暂时不可用";
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", message }) + "\n"),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
