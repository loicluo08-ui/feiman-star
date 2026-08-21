"use client";

// global-error捕获root layout级错误（error.tsx兜不住的那层），必须自带html/body
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#0a0a0a", color: "#ededed" }}>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 16px", textAlign: "center" }}>
          <p style={{ fontSize: "3rem", fontWeight: 700, opacity: 0.5 }}>⚠️</p>
          <h1 style={{ marginTop: 16, fontSize: "1.25rem", fontWeight: 500 }}>应用发生严重错误</h1>
          <p style={{ marginTop: 8, fontSize: "0.875rem", opacity: 0.6, maxWidth: 420 }}>
            整个页面框架层出错。请刷新页面重试；若持续出现，请清除浏览器缓存后访问。
          </p>
          <button
            onClick={() => reset()}
            style={{ marginTop: 24, padding: "10px 20px", borderRadius: 12, border: "none", background: "#ededed", color: "#0a0a0a", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer" }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
