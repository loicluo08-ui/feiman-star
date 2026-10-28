// 深度分析模式API（10/28 agent化第一站——多步自主任务）
// POST /api/invest/deep-analysis {goal} → 创建后台任务返回taskId
// GET  /api/invest/deep-analysis?key= → 轮询状态/进度/结果
// 鉴权与限流：chat同款门禁（登录墙已在middleware层包裹）+deep限流（防滥用：3次/10分/IP）
import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { startTask, getTask } from "@/lib/background-task";
import { runDeepAnalysis } from "@/lib/deep-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 多步任务上限5分钟（Vercel hobby单函数上限内）

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "deepAnalysis", RATE_LIMITS.deepAnalysis);
  if (limited) {
    return NextResponse.json({ ok: false, error: "rate_limited", retryAfter: limited.retryAfter }, { status: 429 });
  }
  let goal = "";
  try {
    const body = (await request.json()) as { goal?: string };
    goal = String(body.goal || "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (goal.length < 6) {
    return NextResponse.json({ ok: false, error: "goal_too_short" }, { status: 400 });
  }
  if (goal.length > 800) {
    return NextResponse.json({ ok: false, error: "goal_too_long" }, { status: 400 });
  }
  const taskId = `deep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  startTask(taskId, () => runDeepAnalysis(taskId, goal));
  return NextResponse.json({ ok: true, taskId });
}

export async function GET(request: NextRequest) {
  const key = (request.nextUrl.searchParams.get("key") || "").trim();
  if (!key.startsWith("deep-")) {
    return NextResponse.json({ ok: false, error: "need_key" }, { status: 400 });
  }
  const task = getTask<import("@/lib/deep-analysis").DeepAnalysisResult>(key);
  if (!task) {
    // 进程内任务表miss=跨实例或已清理——如实告知重试（V1已知限制）
    return NextResponse.json({ ok: false, error: "task_not_found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    status: task.status,
    progress: task.progress || "",
    result: task.status === "success" ? task.result : null,
    error: task.status === "error" ? String(task.error).slice(0, 200) : null,
  });
}
