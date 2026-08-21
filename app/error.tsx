"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 渲染错误上报到服务端日志（Vercel可见）
    console.error("[app-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl font-bold text-[var(--text-muted)]">⚠️</p>
      <h1 className="mt-4 text-xl font-medium text-[var(--text)]">页面出了点问题</h1>
      <p className="mt-2 max-w-md text-sm text-[var(--text-muted)]">
        渲染过程中发生错误。您的数据保存在本地浏览器中不受影响，重试通常可以解决。
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => reset()}
          className="rounded-xl bg-[var(--text)] px-5 py-2.5 text-sm font-medium text-[var(--bg)] transition-opacity hover:opacity-90"
        >
          重试
        </button>
        <a
          href="/"
          className="rounded-xl border border-[var(--border)] px-5 py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
        >
          返回首页
        </a>
      </div>
    </div>
  );
}
