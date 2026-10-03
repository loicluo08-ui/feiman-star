import { NextRequest, NextResponse } from "next/server";

/**
 * 共享口令闸（10/3安全审计P0修复——judgment-cloud可匿名灌毒/team-upload零鉴权/AI端点匿名刷）
 *
 * 单一env：FX_GATE_TOKEN。设备侧：前端首次被拦时prompt一次→localStorage记忆→自动带header。
 * 换口令：改env重部署；设备localStorage.removeItem("fx_gate_token")后刷新。
 *
 * 两种模式：
 * - "open_until_configured"（AI消费路径 chat/pick/review/parse-trades/review-summary/flash-analyze/chat-summarize）：
 *     env未配置=放行（维持公开+限流现状）。激活门禁=在Vercel设置FX_GATE_TOKEN并重部署，零代码变更。
 * - "required"（写路径 judgment-cloud/judgment-sync/team-upload）：
 *     env未配置=503关闭（同CRON_SECRET防裸奔模式）。⚠️部署本修复时必须同时配FX_GATE_TOKEN，
 *     否则判断云端直写/团队上传通道对所有人（包括自家设备）关闭。
 *
 * 传递方式：x-gate-token请求头（首选）或 ?token=查询串（兼容）。Origin校验保留作纵深，不再当唯一门。
 */
export type GateMode = "open_until_configured" | "required";

export function gateCheck(
  request: NextRequest,
  envName: string,
  mode: GateMode
): NextResponse | null {
  const expected = (process.env[envName] || "").trim();
  if (!expected) {
    if (mode === "required") {
      return NextResponse.json(
        { ok: false, error: "gate_not_configured", hint: `服务端未配置${envName}，通道关闭` },
        { status: 503 }
      );
    }
    return null;
  }
  let provided = request.headers.get("x-gate-token")?.trim() || "";
  if (!provided) {
    try {
      provided = new URL(request.url).searchParams.get("token")?.trim() || "";
    } catch {
      provided = "";
    }
  }
  if (provided !== expected) {
    return NextResponse.json(
      { ok: false, error: "gate_required" },
      { status: 401 }
    );
  }
  return null;
}
