import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-bold text-[var(--text-muted)]">404</p>
      <h1 className="mt-4 text-xl font-medium text-[var(--text)]">页面不存在</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        您访问的页面可能已被移除或链接有误
      </p>
      <Link
        href="/"
        className="mt-6 rounded-xl bg-[var(--text)] px-5 py-2.5 text-sm font-medium text-[var(--bg)] transition-opacity hover:opacity-90"
      >
        返回首页
      </Link>
    </div>
  );
}
