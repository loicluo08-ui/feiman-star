import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { generateStructuredJson } from "@/lib/deepseek";
import { buildUploadedContext } from "@/lib/file-extractor";
import { renderPrompt, scriptGeneratorPrompt } from "@/lib/prompt-loader";
import { parseToolRequest } from "@/lib/tool-request";
import {
  scriptGeneratorInputSchema,
  scriptGeneratorOutputSchema,
} from "@/lib/tool-schemas";
import { recordAiCall, refundAiCall, reserveAiCall, usagePayload } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let reservation: Awaited<ReturnType<typeof reserveAiCall>> | null = null;
  let succeeded = false;
  try {
    const { input, upload } = await parseToolRequest(request, scriptGeneratorInputSchema);
    reservation = await reserveAiCall();
    if (!reservation.ok) return reservation.response;

    const systemPrompt = renderPrompt(scriptGeneratorPrompt, {
      ...input,
      kb_content: buildUploadedContext(
        upload,
        "本轮未接入知识库；不得把模型常识当作本机构事实。",
      ),
    });
    const data = await generateStructuredJson({
      systemPrompt,
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
