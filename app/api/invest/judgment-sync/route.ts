import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { z } from "zod";

/**
 * 判断记账云端同步（9/13自动写入管道①）
 * 前端done后POST新增entries → GitHub Contents API写入 repo data/judgments.json
 * → 回验cron（AgentMore侧）pull repo 读数据
 *
 * 安全（9/18全面漏洞检索P0修复）：
 * 原实现 origin.includes(host) 两处失效——①curl等无Origin头直接放行
 * ②子串绕过（sufve.com.evil.com includes "sufve.com"）。
 * 本路由一旦GITHUB_TOKEN配置即成为「公开写repo+commit触发重部署」通道，
 * 防护必须硬：严格origin白名单（无Origin=403，非精确同源=403）
 * + IP限流 + 字段级zod校验（长度/格式收口）+ 服务端时间戳去重。
 */
export const maxDuration = 30;

const REPO = "loicluo08-ui/feiman-star";
const BRANCH = "main";
const FILE_PATH = "data/judgments.json";

type Entry = {
  symbol: string; stance: string; keyLevel: string; invalidation: string;
  confidence: string; date: string; ts: number;
};

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

async function readRemoteJson(token: string): Promise<{ entries: Entry[]; sha: string | null }> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`, {
    headers: ghHeaders(token), cache: "no-store",
  });
  if (res.status === 404) return { entries: [], sha: null };
  if (!res.ok) throw new Error(`github_read_${res.status}`);
  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  return { entries: Array.isArray(content.entries) ? content.entries : [], sha: data.sha };
}

export async function POST(request: NextRequest) {
  // P0①：IP限流（此前缺失——脚本刷写=每次commit烧Vercel构建额度）
  const limited = await enforceRateLimitAsync(request, "judgmentSync", { maxRequests: 10, windowMs: 60_000 });
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  // P0②：严格同源校验——浏览器跨域POST必带Origin；无Origin=非浏览器=403。
  // 精确匹配 scheme+host（端口省略仅允许https默认），不做子串includes。
  const origin = request.headers.get("origin") ?? "";
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const allowedOrigins = new Set([`https://${host}`, `http://${host}`]);
  if (!origin || !allowedOrigins.has(origin)) {
    return NextResponse.json({ error: "origin_mismatch" }, { status: 403 });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    // 诊断模式：明确定义缺失项，部署侧一键配置后管道即通（GET已不再泄露该状态）
    return NextResponse.json({ ok: false, error: "sync_disabled" }, { status: 501 });
  }

  // P0③：字段级zod收口——symbol格式/各字段长度/单次条数，垃圾数据在写入前被拒
  const entrySchema = z.object({
    symbol: z.string().trim().regex(/^[A-Z]{1,6}(\.[A-Z])?$/, "代码格式非法"),
    stance: z.string().trim().min(1).max(40),
    keyLevel: z.string().trim().max(120).optional().default(""),
    invalidation: z.string().trim().max(200).optional().default(""),
    confidence: z.string().trim().max(20).optional().default(""),
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    ts: z.number().int().positive(),
  });
  const requestSchema = z.object({ entries: z.array(entrySchema).min(1).max(50) });

  const body = await request.json().catch(() => null);
  const input = requestSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: "entries格式非法" }, { status: 400 });
  }
  const incoming = input.data.entries;

  try {
    const { entries: existing, sha } = await readRemoteJson(token);
    const seen = new Set(existing.map((e) => e.ts));
    // P0④：服务端时间戳归一去重——客户端ts可伪造，改为「ts相同即丢弃」，并把未来时间戳钳到当前
    const now = Date.now();
    const valid = incoming
      .map((e) => ({ ...e, ts: Math.min(e.ts, now) }))
      .filter((e) => !seen.has(e.ts));
    if (valid.length === 0) return NextResponse.json({ ok: true, added: 0, total: existing.length });
    const merged = [...existing, ...valid].slice(-500);
    const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify({
        message: `chore: 判断记账同步+${valid.length}条（前端自动）`,
        content: Buffer.from(JSON.stringify({ entries: merged }, null, 2)).toString("base64"),
        sha, branch: BRANCH,
      }),
    });
    if (!put.ok) return NextResponse.json({ error: `github_write_${put.status}` }, { status: 502 });
    // P2②双写Supabase（服务端闭环——回验管道未来直读库），失败不影响GitHub主通道
    try {
      const { insertLedgerRows } = await import("@/lib/supabase");
      await insertLedgerRows(valid.map((e) => ({
        symbol: e.symbol, stance: e.stance, key_level: e.keyLevel || null,
        invalidation: e.invalidation || null, confidence: e.confidence || null,
        date: e.date, ts: new Date(e.ts).toISOString(),
      })) as Parameters<typeof insertLedgerRows>[0]);
    } catch {
      // DB写失败不影响GitHub通道
    }
    return NextResponse.json({ ok: true, added: valid.length, total: merged.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 80) : "sync_failed" }, { status: 502 });
  }
}

export async function GET() {
  // P1：不再泄露 tokenConfigured/pipeline 内部细节——端点存在性本身足够诊断用
  return NextResponse.json({ ok: true });
}
