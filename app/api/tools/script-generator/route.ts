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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { input, upload } = await parseToolRequest(request, scriptGeneratorInputSchema);
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

    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
