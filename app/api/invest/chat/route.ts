import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callAI, callVisionAI, type VisionMessage } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const textSchema = z.object({
  type: z.literal("text"),
  text: z.string().trim().min(1).max(4000),
});

const imageSchema = z.object({
  type: z.literal("image"),
  dataUrl: z.string().regex(/^data:image\/(jpeg|png|webp);base64,/),
  text: z.string().trim().max(4000).optional(),
});

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([textSchema, imageSchema]),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(20),
  style: z.enum(["balanced", "value", "growth", "quant"]).optional().default("balanced"),
});

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const input = requestSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  }

  const messages = input.data.messages;

  // 检查是否有图片
  const hasImage = messages.some(
    (m) => m.content.type === "image" && m.content.dataUrl.length < MAX_IMAGE_SIZE * 1.4
  );

  const lastUserMessages = messages.filter((m) => m.role === "user");
  const lastMessage = lastUserMessages[lastUserMessages.length - 1];

  // 构建历史对话上下文（最多取最近6轮）
  const recentMessages = messages.slice(-12);

  const stylePrompts: Record<string, string> = {
    balanced: "你是费曼星投资分析助手，专注于美股投资领域。分析风格：均衡，兼顾基本面和技术面。",
    value: "你是费曼星投资分析助手，以价值投资视角分析。参考本杰明·格雷厄姆和沃伦·巴菲特的框架：关注安全边际、内在价值、护城河。对高估值成长股持审慎态度。",
    growth: "你是费曼星投资分析助手，以成长投资视角分析。参考菲利普·费雪和凯瑟琳·伍德的框架：关注TAM、增速、创新壁垒。对传统价值股不过度排斥但强调增长潜力。",
    quant: "你是费曼星投资分析助手，以量化分析视角分析。所有判断必须有数据支撑，禁止模糊表述。关注统计显著性、回撤、夏普比率、相关性。对无法量化的因素明确标注'定性判断'。",
  };

  const systemPrompt = [
    stylePrompts[input.data.style] ?? stylePrompts.balanced,
    "",
    "你可以帮助用户分析股票、解读财报、评估策略、回答投资相关问题。",
    "",
    "当用户发送截图时（K线图、财报数据、持仓截图、交易记录等），你需要：",
    "1. 先描述你在图片中看到的内容",
    "2. 然后基于图片内容给出专业分析",
    "3. 如果是K线图，分析技术面信号",
    "4. 如果是财报数据，分析关键指标",
    "5. 如果是持仓/交易截图，做归因分析",
    "",
    "规则：",
    "- 数据只引用用户提供的，不编造数字",
    "- 不给出买卖建议，只做分析",
    "- 高风险话题（如期权、杠杆）要提示风险",
    "- 末尾加"本分析由AI生成，仅供研究参考，不构成投资建议"",
  ].join("\n");

  try {
    let answer: string | null;

    if (hasImage) {
      // 有图片 → 智谱GLM-4V
      const visionMessages: VisionMessage[] = [
        { role: "system", content: systemPrompt },
        ...recentMessages.map((m) => {
          if (m.content.type === "text") {
            return { role: m.role, content: m.content.text } as VisionMessage;
          }
          // 图片消息：把用户文字（如有）和图片合并
          const userText = m.content.text ?? "请分析这张图片";
          return {
            role: m.role,
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: m.content.dataUrl } },
            ],
          } as VisionMessage;
        }),
      ];

      answer = await callVisionAI(visionMessages, {
        temperature: 0.4,
        max_tokens: 3000,
        retry: 1,
      });
    } else {
      // 纯文字 → DeepSeek
      const textMessages = recentMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content.type === "text" ? m.content.text : "",
      }));

      const cleanMessages = textMessages.filter((m) => m.content.length > 0);

      answer = await callAI(
        [
          { role: "system", content: systemPrompt },
          ...cleanMessages,
        ],
        { responseFormat: "text", temperature: 0.4, max_tokens: 3000, retry: 1 },
      );
    }

    if (!answer) {
      return NextResponse.json({ error: "AI服务暂时不可用" }, { status: 503 });
    }

    return NextResponse.json(
      { data: { answer } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[invest/chat]", error);
    return NextResponse.json({ error: "AI分析暂时不可用" }, { status: 503 });
  }
}
