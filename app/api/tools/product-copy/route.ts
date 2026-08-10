import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { generateStructuredJson } from "@/lib/deepseek";
import { buildUploadedContext } from "@/lib/file-extractor";
import { productCopyPrompt, renderPrompt, replacePromptExamples } from "@/lib/prompt-loader";
import { parseToolRequest } from "@/lib/tool-request";
import { productCopyInputSchema, productCopyOutputSchema } from "@/lib/tool-schemas";
import { recordAiCall, refundAiCall, reserveAiCall, usagePayload } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const noReusableProductFacts = `<example_policy>
为避免把示例商品的参数、承诺或经营信息误用于当前商品，本次不提供可复用的商品事实案例。严格按task中的结构、rules和output_format生成，所有商品事实只取自当前context。
</example_policy>`;

export async function POST(request: Request) {
  let reservation: Awaited<ReturnType<typeof reserveAiCall>> | null = null;
  let succeeded = false;
  try {
    const { input, upload } = await parseToolRequest(request, productCopyInputSchema);
    reservation = await reserveAiCall();
    if (!reservation.ok) return reservation.response;

    const uploadedContext = buildUploadedContext(
      upload,
      "本轮未导入商品资料；不得把模型常识当作商品的具体参数、销量或承诺。",
    );
    const systemPrompt = renderPrompt(replacePromptExamples(productCopyPrompt, noReusableProductFacts), {
      ...input,
      kb_content: uploadedContext,
    });
    const draft = await generateStructuredJson({
      systemPrompt,
      outputSchema: productCopyOutputSchema,
      maxTokens: 4_096,
    });
    const data = await generateStructuredJson({
      systemPrompt: `<role>你是电商文案的商品事实审核员。重写草稿，删除所有没有当前商品资料依据的具体事实与经营承诺，同时保留转化力和JSON结构。</role>
<allowed_facts>
商品名称：${input.product_name}
原始卖点：${input.selling_points}
目标人群：${input.target_audience}
投放平台：${input.platform}
用户商品资料：${uploadedContext}
</allowed_facts>
<draft>${JSON.stringify(draft)}</draft>
<audit_rules>
1. 商品的数字、材质属性、功效、规格、版型、耐用性、价格、优惠、库存、活动、赠品、发货和售后承诺，只能来自allowed_facts原文。
2. 删除模型根据商品类别自动补出的事实。例如：没有依据就不能写具体温度、凉感程度、洗后表现、组合价更低、今天发货或限时库存。
3. 可保留不冒充商品事实的生活场景与一般性痛点；competitor_insight可以基于常识做概括，但不得声称掌握实时销量、评价或平台数据。
4. 保留5个titles、理性/感性/紧迫3版4段正文、3-5条refined_selling_points和competitor_insight。
5. 紧迫型没有真实活动或库存时，只能使用季节、使用计划等自然行动理由，不得虚构促销。
6. 只输出与草稿相同结构的合法JSON对象。
</audit_rules>`,
      outputSchema: productCopyOutputSchema,
      maxTokens: 4_096,
    });

    succeeded = true;
    await recordAiCall(reservation, "product-copy");
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
