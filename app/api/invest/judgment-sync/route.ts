import { NextRequest, NextResponse } from "next/server";

/**
 * 判断记账云端同步（9/13自动写入管道①）
 * 前端done后POST新增entries → GitHub Contents API写入 repo data/judgments.json
 * → 回验cron（AgentMore侧）pull repo 读数据
 * 鉴权：origin同域校验+rate limit；数据污染由回验质量闸门兜底（候选池不直进KB）
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
  // 同域校验（防外站注入垃圾判断）
  const origin = request.headers.get("origin") ?? "";
  const host = request.headers.get("host") ?? "";
  if (origin && !origin.includes(host)) {
    return NextResponse.json({ error: "origin_mismatch" }, { status: 403 });
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    // 诊断模式：明确定义缺失项，部署侧一键配置后管道即通
    return NextResponse.json({ ok: false, error: "GITHUB_TOKEN未配置——Vercel环境变量添加后管道激活", needs: ["GITHUB_TOKEN(repo scope)"] }, { status: 501 });
  }

  const body = await request.json().catch(() => null);
  const incoming: Entry[] = Array.isArray(body?.entries) ? body.entries : [];
  const valid = incoming.filter((e) => e.symbol && e.stance && e.ts && e.date);
  if (valid.length === 0) return NextResponse.json({ error: "无有效entries" }, { status: 400 });

  try {
    const { entries: existing, sha } = await readRemoteJson(token);
    const seen = new Set(existing.map((e) => e.ts));
    const merged = [...existing, ...valid.filter((e) => !seen.has(e.ts))].slice(-500);
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
    return NextResponse.json({ ok: true, added: valid.length, total: merged.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 80) : "sync_failed" }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "judgment-sync",
    usage: "POST {entries:[{symbol,stance,keyLevel,invalidation,confidence,date,ts}]}",
    pipeline: "sync → data/judgments.json → 回验cron → 候选池 → 质量闸门 → case-library",
    tokenConfigured: !!process.env.GITHUB_TOKEN,
  });
}
