/**
 * 用户反馈提交 API（10/27逸翔授权"你来做出最优决定"：关于页+反馈闭环）
 * POST /api/feedback  body: { kind: "suggestion"|"bug"|"other", nickname?: string, text: string }
 * 存储：Supabase kb_dynamic 表 type="feedback"（零DDL复用）；readKbEntries语义检索读路径已排除feedback
 * 防滥用：globalRateLimit 5条/10分钟/IP（cf-connecting-ip取真实IP防伪造，insertChatLog同款）
 */
import { NextResponse } from "next/server";
import { insertFeedback, supabaseConfigured } from "@/lib/supabase";
import { globalRateLimit } from "@/lib/rate-limit";

const KINDS = new Set(["suggestion", "bug", "other"]);
const TEXT_MAX = 2000;
const NICK_MAX = 30;

export async function POST(request: Request) {
  // Supabase未配置=功能关闭（fail-closed，其他写路径同款模式）
  if (!supabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "反馈通道未启用" }, { status: 503 });
  }

  const ip =
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";

  // 限流：5条/10分钟/IP（真人远够，脚本刷量挡住）
  const rl = await globalRateLimit(`feedback:${ip}`, 5, 600_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "提交太频繁，请稍后再试" }, { status: 429 });
  }

  let body: { kind?: string; nickname?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式错误" }, { status: 400 });
  }

  const kind = (body.kind || "").trim();
  if (!KINDS.has(kind)) {
    return NextResponse.json({ ok: false, error: "反馈类型无效" }, { status: 400 });
  }
  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: "内容不能为空" }, { status: 400 });
  }
  if (text.length > TEXT_MAX) {
    return NextResponse.json({ ok: false, error: `内容过长（上限${TEXT_MAX}字）` }, { status: 400 });
  }
  const nickname = (body.nickname || "").trim().slice(0, NICK_MAX) || "匿名";

  const entry = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    nickname,
    text,
    ip,
    ua: (request.headers.get("user-agent") || "").slice(0, 200),
    ts: new Date().toISOString(),
  };
  const ok = await insertFeedback(entry);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "存储失败，请稍后再试" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
