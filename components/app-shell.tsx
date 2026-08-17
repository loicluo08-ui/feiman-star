"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getTasks, subscribeTasks } from "@/lib/background-task";

const navItems = [
  { href: "/", label: "首页", icon: "M3 12L12 3l9 9M5 10v10h14V10" },
  { href: "/invest/flash", label: "实时快讯", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
  { href: "/invest/market", label: "市场快报", icon: "M3 3v18h18M7 14l4-4 4 4 5-5" },
  { href: "/invest/calendar", label: "财报日历", icon: "M7 3v3M17 3v3M4 8h16M5 5h14v16H5zM8 12h3M13 12h3M8 16h3" },
  { href: "/invest/pick", label: "AI选股", icon: "M3 3v18h18M7 14l4-4 4 4 5-5" },
  { href: "/invest/review", label: "交易复盘", icon: "M9 17v-6h4v6M7 7h10v10H7zM5 5h14v14H5z" },
  { href: "/invest/chat", label: "投资对话", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
];

function SidebarContent({
  pathname,
  theme,
  onToggleTheme,
  onNavigate,
  showClose = false,
}: {
  pathname: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onNavigate?: () => void;
  showClose?: boolean;
}) {
  return (
    <>
      <div className="mb-8 flex items-center justify-between gap-3 px-2">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--primary)] text-sm font-bold text-[var(--primary-foreground)]">费</span>
          <span className="text-[15px] font-semibold tracking-tight">费曼星</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {showClose ? (
            <button
              onClick={onNavigate}
              className="grid h-8 w-8 place-items-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
              aria-label="关闭导航菜单"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-[var(--surface-muted)] font-medium text-[var(--text)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-[var(--border)] pt-3">
        <p className="px-3 text-xs text-[var(--text-muted)]">投资分析工具站</p>
        <p className="mt-1 px-3 text-xs text-[var(--text-muted)]">仅供研究参考</p>
      </div>
    </>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
      aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      title={theme === "dark" ? "浅色模式" : "深色模式"}
    >
      {theme === "dark" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [runningTaskKey, setRunningTaskKey] = useState<string | null>(null);
  const [runningTaskProgress, setRunningTaskProgress] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(currentTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    try {
      localStorage.setItem("feimanstar_theme", nextTheme);
    } catch {
      // localStorage不可用时仍可切换当前页面主题。
    }
  }

  useEffect(() => {
    const updateRunningTask = () => {
      const runningTask = getTasks().find(([, task]) => task.status === "running");
      setRunningTaskKey(runningTask?.[0] ?? null);
      setRunningTaskProgress(runningTask?.[1].progress ?? null);
    };

    updateRunningTask();
    return subscribeTasks(updateRunningTask);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-[var(--bg)] md:flex">
      {runningTaskKey ? (
        <div
          className="fixed inset-x-0 top-0 z-[70] h-1 overflow-hidden bg-[var(--border)] md:left-56"
          title={runningTaskProgress || ({
            "pick-analysis": "AI选股分析中…",
            "review-analysis": "AI复盘分析中…",
            "chat-response": "AI回复中…",
          }[runningTaskKey] ?? "AI任务处理中…")}
        >
          <div className="h-full w-full animate-pulse bg-[var(--primary)]" />
        </div>
      ) : null}

      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] px-3 py-5 md:flex">
        <SidebarContent pathname={pathname} theme={theme} onToggleTheme={toggleTheme} />
      </aside>

      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center border-b border-[var(--border)] bg-[var(--surface)] px-4 md:hidden">
        <button
          onClick={() => setMenuOpen(true)}
          className="mr-3 grid h-8 w-8 place-items-center rounded-lg text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)]"
          aria-label="打开导航菜单"
          aria-expanded={menuOpen}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--primary)] text-xs font-bold text-[var(--primary-foreground)]">费</span>
          <span className="text-sm font-semibold">费曼星</span>
        </Link>
        <div className="ml-auto">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-black/35"
            onClick={() => setMenuOpen(false)}
            aria-label="关闭导航菜单"
          />
          <aside className="relative z-[60] flex h-full w-[70%] max-w-xs flex-col bg-[var(--surface)] px-3 py-5 shadow-2xl">
            <SidebarContent
              pathname={pathname}
              theme={theme}
              onToggleTheme={toggleTheme}
              onNavigate={() => setMenuOpen(false)}
              showClose
            />
          </aside>
        </div>
      ) : null}

      <main className="min-w-0 flex-1 pt-12 md:pt-0">{children}</main>
    </div>
  );
}
