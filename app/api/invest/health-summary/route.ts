import { NextRequest, NextResponse } from "next/server";
import { supabaseConfigured, readAllLedger } from "@/lib/supabase";
import { snapshot } from "@/lib/health-counters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * 内部健康汇总（10/4稳定性工程环2——反静默失效：一个请求看全内部健康）
 *
 * 供巡检cron拉取。巡检此前只能测外部端点状态（200/条数），测不到"活着但在悄悄降级"——
 * 本端点聚合：DeepSeek余额 / 判断管道时间戳（GitHub+Supabase）/ AI通道降级计数 / env配置闸状态。
 *
 * 鉴权：?token= 或 x-admin-token header（同admin路由兼容模式）——配置了ADMIN_TOKEN则强制。
 * 计数器语义：Vercel进程窗口期指标（重启清零），since字段=计数起点。
 */

async function deepseekBalance(): Promise<{ balance?: number; error?: string }> {
  const KEY = process.env.DEEPSEEK_API_KEY;
  if (!KEY) return { error: "key_not_configured" };
  try {
    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { error: `http_${res.status}` };
    const j = (await res.json()) as {
      is_available?: boolean;
      balance_infos?: Array<{ currency: string; total_amount: string }>;
    };
    const cny = (j.balance_infos || []).find((x) => x.currency === "CNY");
    return { balance: cny ? Number(cny.total_amount) : undefined };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 60) : "unknown" };
  }
}

/** GitHub judgments.json最后commit时间——判断供血段"活着"的直接证据（心跳cron可对它做停滞告警） */
async function githubJudgmentsAge(): Promise<{ lastCommit?: string; error?: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { error: "token_not_configured" };
  try {
    const res = await fetch(
      "https://api.github.com/repos/loicluo08-ui/feiman-star/commits?path=data/judgments.json&per_page=1",
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return { error: `http_${res.status}` };
    const arr = (await res.json()) as Array<{ commit?: { committer?: { date?: string } } }>;
    const date = arr?.[0]?.commit?.committer?.date;
    return date ? { lastCommit: date } : { error: "empty_response" };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 60) : "unknown" };
  }
}

/** Supabase账本最新一条ts——展示链"活着"的直接证据 */
async function ledgerLatest(): Promise<{ latestTs?: string; error?: string }> {
  if (!supabaseConfigured()) return { error: "supabase_not_configured" };
  try {
    const rows = await readAllLedger(1);
    if (rows === null) return { error: "query_failed" };
    return { latestTs: rows[0]?.ts ?? "empty_table" };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 60) : "unknown" };
  }
}

export async function GET(request: NextRequest) {
  const ADMIN = (process.env.ADMIN_TOKEN || "").trim();
  if (ADMIN) {
    const provided =
      request.headers.get("x-admin-token")?.trim() ||
      new URL(request.url).searchParams.get("token")?.trim() ||
      "";
    if (provided !== ADMIN) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const [balance, gh, ledger] = await Promise.all([
    deepseekBalance(),
    githubJudgmentsAge(),
    ledgerLatest(),
  ]);

  const envFlags = {
    fx_gate_token: Boolean((process.env.FX_GATE_TOKEN || "").trim()),
    github_token: Boolean((process.env.GITHUB_TOKEN || "").trim()),
    supabase: supabaseConfigured(),
    deepseek_key: Boolean((process.env.DEEPSEEK_API_KEY || "").trim()),
  };

  return NextResponse.json(
    {
      ok: true,
      checkedAt: new Date().toISOString(),
      balance,
      judgmentPipeline: {
        githubJudgments: gh,
        supabaseLedger: ledger,
        envFlags: { github_token: envFlags.github_token, supabase: envFlags.supabase },
      },
      counters: snapshot(),
      envFlags,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
