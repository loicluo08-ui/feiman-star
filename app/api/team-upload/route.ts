import { NextRequest, NextResponse } from "next/server";
import { gateCheck } from "@/lib/gate";

const REPO = "loicluo08-ui/team-inbox";
const MAX_SIZE = 4 * 1024 * 1024; // Vercel serverless 请求体安全上限

function sanitizeName(raw: string): string | null {
  const name = (raw || "").replace(/[\\/:*?"<>|#%&{}$!'@+=`~\s]/g, "_").trim();
  if (!name || name.length > 80) return null;
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_\-.()（）\[\]]+$/.test(name)) return null;
  return name;
}

async function ghApi(token: string, path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "team-upload-relay",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function POST(req: NextRequest) {
  // 10/3审计P0：共享口令闸（写路径fail-closed——FX_GATE_TOKEN未配置=通道关闭）
  const gated = gateCheck(req, "FX_GATE_TOKEN", "required");
  if (gated) return gated;
  const token = process.env.TEAM_INBOX_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: "服务端上传凭据未配置（TEAM_INBOX_TOKEN）" }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "请求体解析失败（单文件需≤4MB）" },
      { status: 413 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "未收到文件" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { ok: false, error: `文件 ${(file.size / 1048576).toFixed(1)}MB 超过 4MB 上限，请改用 GitHub 网页上传（Add file → Upload files）` },
      { status: 413 }
    );
  }

  const name = sanitizeName(file.name || "");
  if (!name) {
    return NextResponse.json(
      { ok: false, error: "文件名含特殊字符或过长，请重命名为：队N_内容_日期.html" },
      { status: 400 }
    );
  }

  let path = name;
  try {
    const check = await ghApi(token, encodeURIComponent(name), "GET");
    if (check.status === 200) {
      const stamp = new Date()
        .toISOString()
        .replace(/[-:T]/g, "")
        .slice(0, 14);
      const dot = name.lastIndexOf(".");
      path = dot > 0 ? `${name.slice(0, dot)}_${stamp}${name.slice(dot)}` : `${name}_${stamp}`;
    }
  } catch {
    // 同名检查失败不阻断；真同名时 GitHub 会报 422 走兜底提示
  }

  const content = Buffer.from(await file.arrayBuffer()).toString("base64");
  const gh = await ghApi(token, encodeURIComponent(path), "PUT", {
    message: `upload: ${name}（团队上传页）`,
    content,
    branch: "main",
  });

  if (!gh.ok) {
    const detail = await gh.text();
    if (gh.status === 422) {
      return NextResponse.json({ ok: false, error: "同名冲突且重试失败，请稍后再传" }, { status: 502 });
    }
    return NextResponse.json(
      { ok: false, error: `转存失败（GitHub ${gh.status}）${detail.slice(0, 120)}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, path, size: file.size });
}
