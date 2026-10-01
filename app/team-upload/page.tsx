"use client";

import { useCallback, useRef, useState } from "react";

type UpState = "idle" | "uploading" | "done" | "error";

export default function TeamUploadPage() {
  const [dragOver, setDragOver] = useState(false);
  const [state, setState] = useState<UpState>("idle");
  const [msg, setMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    setFileName(file.name);
    setState("uploading");
    setMsg("上传中…");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/team-upload", { method: "POST", body: form });
      const data = (await res.json()) as { ok: boolean; error?: string; path?: string };
      if (data.ok) {
        setState("done");
        setMsg(`✅ 上传成功：${data.path}（30 分钟内自动检出验收）`);
      } else {
        setState("error");
        setMsg(`❌ ${data.error || "上传失败"}`);
      }
    } catch {
      setState("error");
      setMsg("❌ 网络异常，请重试");
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void upload(file);
    },
    [upload]
  );

  const busy = state === "uploading";

  return (
    <main style={{ minHeight: "100vh", background: "#0d1117", color: "#e6edf3", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 560 }}>
        <h1 style={{ fontSize: 26, marginBottom: 6 }}>五队成果上传</h1>
        <p style={{ color: "#8b949e", fontSize: 14, margin: "0 0 20px", lineHeight: 1.6 }}>
          拖入或选择文件，自动转入成果中转仓，无需注册任何账号。<br />
          命名建议：队N_内容_日期.html ｜ 单文件 ≤ 4MB
        </p>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !busy && inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "#2f81f7" : "#30363d"}`,
            borderRadius: 12,
            padding: "48px 24px",
            textAlign: "center",
            cursor: busy ? "wait" : "pointer",
            background: dragOver ? "rgba(47,129,247,0.08)" : "#161b22",
            transition: "all .15s",
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 10 }}>📤</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{busy ? "上传中…" : "把文件拖到这里，或点击选择"}</div>
          <div style={{ color: "#8b949e", fontSize: 13, marginTop: 8 }}>{fileName || "支持 HTML / MD / ZIP / 图片"}</div>
        </div>

        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />

        {msg && (
          <div
            style={{
              marginTop: 18,
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 14,
              lineHeight: 1.6,
              background: state === "done" ? "rgba(14,159,110,0.12)" : state === "error" ? "rgba(248,81,73,0.12)" : "rgba(47,129,247,0.1)",
              color: state === "done" ? "#3fb950" : state === "error" ? "#f85149" : "#58a6ff",
              wordBreak: "break-all",
            }}
          >
            {msg}
          </div>
        )}

        <p style={{ color: "#484f58", fontSize: 12, marginTop: 20, lineHeight: 1.6 }}>
          超过 4MB 的大文件：请到 github.com/loicluo08-ui/team-inbox 用网页上传（需登录）。成果上传后请勿重复提交。
        </p>
      </div>
    </main>
  );
}
