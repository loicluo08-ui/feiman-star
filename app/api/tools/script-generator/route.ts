import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { generateStructuredJson } from "@/lib/deepseek";
import { buildUploadedContext } from "@/lib/file-extractor";
import { renderPrompt, replacePromptExamples, scriptGeneratorPrompt } from "@/lib/prompt-loader";
import { escapeXmlText } from "@/lib/prompt-security";
import { parseToolRequest } from "@/lib/tool-request";
import {
  scriptGeneratorInputSchema,
  scriptGeneratorOutputSchema,
} from "@/lib/tool-schemas";
import { recordAiCall, refundAiCall, reserveAiCall, usagePayload } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const safeFewShotExample = `<example>
<example_context>
机构名称：示例艺术中心
课程类型：钢琴
价格区间：120-180元/课时
机构常见问题：只有“价格/课时/师资/试听”关注项，没有标准答案
机构知识库：未提供
</example_context>
<input>你们钢琴课多少钱？孩子5岁零基础，之前学过半年没兴趣了</input>
<output>
{
  "stable": {
    "answer": "单课时在120-180元之间。总课时、班型和对应价格资料里没有，我需要向教务确认后回复您，今天内给您准确答复。",
    "value": "孩子5岁零基础，课程安排需要结合年龄和之前的学习体验来判断。具体怎么帮助孩子重新建立兴趣，我先核对课程方案，不先给您空承诺。",
    "objection": "您担心的不只是价格，更怕孩子再次失去兴趣、钱花了没有继续学。这一点需要把课程方式和孩子情况一起确认，不能只看报价。",
    "action": "您可以告诉我孩子之前主要在哪个环节觉得没兴趣，我今天向教务核对适合的安排和完整费用，再把准确资料发您。"
  },
  "aggressive": {
    "answer": "目前能确认的是单课时120-180元；总课时和班型价格需要教务按孩子情况核对，我今天内给您准确答复。",
    "value": "5岁零基础又有过中断经历，先判断不感兴趣的原因，比直接报班更重要。课程方案资料尚未提供，我会先替您把关键问题问清楚。",
    "objection": "如果只报一个价格，您仍然不知道孩子这次能不能适应。先把班型、上课方式和费用对应关系查清楚，才能避免盲目选择。",
    "action": "把孩子之前每次上课时长和不喜欢的表现发我，我马上向教务核对，今天给您一份价格和安排都清楚的回复。"
  },
  "gentle": {
    "answer": "单课时是120-180元，其他费用和班型我需要向教务确认后回复您，今天内给您准确答复。",
    "value": "孩子之前学过却没兴趣，先了解原因会更稳妥，不用急着做决定。具体课程如何安排，我确认真实资料后再和您说明。",
    "objection": "您担心再次报了课孩子还是不喜欢，这个顾虑很实际。现在资料不足，我不会先承诺效果，也不会催您报名。",
    "action": "您方便说说孩子之前最抗拒什么吗？我先记录下来，连同准确价格和课程安排一起确认后发您。"
  },
  "title_suggestions": ["5岁钢琴课程费用确认", "零基础班型资料核对", "孩子兴趣情况沟通"],
  "follow_up_advice": "今天内向教务确认总课时、班型、师资和试听政策，再把有依据的完整资料发给家长；未确认前不发送案例或效果承诺。"
}
</output>
</example>`;

export async function POST(request: Request) {
  let reservation: Awaited<ReturnType<typeof reserveAiCall>> | null = null;
  let succeeded = false;
  try {
    const { input, upload } = await parseToolRequest(request, scriptGeneratorInputSchema);
    reservation = await reserveAiCall();
    if (!reservation.ok) return reservation.response;

    const uploadedContext = buildUploadedContext(
      upload,
      "本轮未接入知识库；不得把模型常识当作本机构事实。",
    );
    const systemPrompt = renderPrompt(replacePromptExamples(scriptGeneratorPrompt, safeFewShotExample), {
      ...input,
      kb_content: uploadedContext,
    });
    const draft = await generateStructuredJson({
      systemPrompt,
      outputSchema: scriptGeneratorOutputSchema,
      maxTokens: 4_096,
    });
    const data = await generateStructuredJson({
      systemPrompt: `<role>你是教培话术的事实审核员。你的唯一任务是重写草稿，删除一切没有资料依据的机构事实，同时保持三种策略和JSON结构完整。</role>
<allowed_facts>
机构名称：${escapeXmlText(input.institution_name)}
课程类型：${escapeXmlText(input.course_type)}
价格区间：${escapeXmlText(input.price_range)}
机构常见问题与标准答案：${escapeXmlText(input.faq_list)}
机构知识库：${escapeXmlText(uploadedContext)}
家长原话：${escapeXmlText(input.parent_question)}
</allowed_facts>
<draft>${escapeXmlText(JSON.stringify(draft))}</draft>
<audit_rules>
1. 只有allowed_facts中的明确陈述可写成当前机构事实。关注项名称不等于标准答案。
2. 删除或改写所有无依据的课时数、班型、分班方式、师生比、教材、教学方法、师资、试听、时间、名额、优惠、学员案例、效果、服务和政策。
3. 资料不足时必须写“这个问题我需要向教务确认后回复您，今天内给您准确答复”，不能用模型常识补齐。
4. 可以分析家长顾虑，但不能把一般建议写成“我们机构就是这样做”的事实。
5. 保留stable/aggressive/gentle各4段、3条title_suggestions和follow_up_advice；三版策略仍须有明显差异。
6. 禁用“亲爱的”“非常理解”“您说得对”，不使用绝对承诺，不评价其他机构。
7. 只输出与草稿相同结构的合法JSON对象。
</audit_rules>`,
      outputSchema: scriptGeneratorOutputSchema,
      maxTokens: 4_096,
    });

    succeeded = true;
    await recordAiCall(reservation, "script-generator");
    return NextResponse.json(
      { data, usage: usagePayload(reservation) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  } finally {
    if (reservation?.ok && !succeeded) await refundAiCall(reservation);
  }
}
