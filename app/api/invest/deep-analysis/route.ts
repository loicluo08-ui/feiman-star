// 深度分析模式API（10/28 agent化第一站——多步自主任务）
// POST /api/invest/deep-analysis {goal} → 创建后台任务返回taskId
// GET  /api/invest/deep-analysis?key= → 轮询状态/进度/结果
// 鉴权与限流：chat同款门禁（登录墙已在middleware层包裹）+deep限流（防滥用：3次/10分/IP）
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { startTask, getTask } from "@/lib/background-task";
import { runDeepAnalysis } from "@/lib/deep-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby版cap 60s（10/28交叉验证实锤：300s=Pro only）——预算：拆解15s+并行收集30s+汇总35s

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
  const task = startTask(taskId, () => runDeepAnalysis(taskId, goal));
  // 10/28交叉验证P1修正：响应返回后serverless进程冻结=floating promise被杀（chat await方案此处不适用
  // ——任务跑60s不能阻塞响应）。waitUntil（@vercel/functions，Node runtime官方支持）=响应后存活到promise完成
  waitUntil(task.promise);
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
