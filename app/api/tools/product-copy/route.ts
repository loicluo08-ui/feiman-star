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
export const maxDuration = 60;

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

    const systemPrompt = renderPrompt(replacePromptExamples(productCopyPrompt, noReusableProductFacts), {
      ...input,
      kb_content: buildUploadedContext(
        upload,
        "本轮未导入商品资料；不得把模型常识当作商品的具体参数、销量或承诺。",
      ),
    });
    const data = await generateStructuredJson({
      systemPrompt,
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
