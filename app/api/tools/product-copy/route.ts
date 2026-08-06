import { NextRequest, NextResponse } from "next/server";
import { callAI, sanitizeInput } from "@/lib/ai";
import { buildProductCopyPrompt } from "@/lib/prompts/product-copy";

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
    const productName = sanitizeInput(body.productName, 200);
    const productInfo = sanitizeInput(body.productInfo);
    const targetAudience = sanitizeInput(body.targetAudience, 500);
    const platform = sanitizeInput(body.platform, 50);

    if (!productName.ok || !productInfo.ok || !targetAudience.ok || !platform.ok) {
      return NextResponse.json({ success: false, error: "缺少必填字段或输入不合法" }, { status: 400 });
    }

    const priceRange = optionalText(body.priceRange, 200);
    const knowledgeBase = optionalText(body.knowledgeBase, 50_000);
    if (priceRange === null || knowledgeBase === null) {
      return NextResponse.json({ success: false, error: "输入不合法" }, { status: 400 });
    }

    const messages = buildProductCopyPrompt({
      productName: productName.text,
      productInfo: productInfo.text,
      targetAudience: targetAudience.text,
      platform: platform.text,
      priceRange,
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
    console.error("[product-copy] api_error", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ success: false, error: "服务器内部错误" }, { status: 500 });
  }
}
