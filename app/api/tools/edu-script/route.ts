import { NextRequest, NextResponse } from "next/server";
import { callAI, sanitizeInput } from "@/lib/ai";
import { buildEduScriptPrompt } from "@/lib/prompts/edu-script";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function parseAIJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as unknown;
    } catch {
      return null;
    }
  }
}

function optionalText(value: unknown, maxLength = 20_000) {
  if (value === undefined || value === null || value === "") return undefined;
  const result = sanitizeInput(value, maxLength);
  return result.ok ? result.text : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const institutionName = sanitizeInput(body.institutionName, 200);
    const courseType = sanitizeInput(body.courseType, 200);
    const parentQuestion = sanitizeInput(body.parentQuestion, 4_000);

    if (!institutionName.ok || !courseType.ok || !parentQuestion.ok) {
      return NextResponse.json({ success: false, error: "缺少必填字段或输入不合法" }, { status: 400 });
    }

    const priceRange = optionalText(body.priceRange, 200);
    const institutionInfo = optionalText(body.institutionInfo, 20_000);
    const knowledgeBase = optionalText(body.knowledgeBase, 50_000);
    if (priceRange === null || institutionInfo === null || knowledgeBase === null) {
      return NextResponse.json({ success: false, error: "输入不合法" }, { status: 400 });
    }

    const messages = buildEduScriptPrompt({
      institutionName: institutionName.text,
      courseType: courseType.text,
      parentQuestion: parentQuestion.text,
      priceRange,
      institutionInfo,
      knowledgeBase,
    });
    const raw = await callAI(messages, {
      temperature: 0.7,
      max_tokens: 2_500,
      retry: 1,
      timeout: 45_000,
    });

    if (!raw) {
      return NextResponse.json({ success: false, error: "AI服务暂时不可用" }, { status: 503 });
    }

    const parsed = parseAIJson(raw);
    if (!parsed) {
      return NextResponse.json({ success: false, error: "AI输出格式异常" }, { status: 502 });
    }

    return NextResponse.json(
      { success: true, data: parsed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[edu-script] api_error", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ success: false, error: "服务器内部错误" }, { status: 500 });
  }
}
