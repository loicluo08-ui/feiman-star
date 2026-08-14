"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getTasks, subscribeTasks } from "@/lib/background-task";

const navItems = [
  { href: "/", label: "首页", icon: "M3 12L12 3l9 9M5 10v10h14V10" },
  { href: "/invest/market", label: "市场快报", icon: "M3 3v18h18M7 14l4-4 4 4 5-5" },
  { href: "/invest/pick", label: "AI选股", icon: "M3 3v18h18M7 14l4-4 4 4 5-5" },
  { href: "/invest/review", label: "交易复盘", icon: "M9 17v-6h4v6M7 7h10v10H7zM5 5h14v14H5z" },
  { href: "/invest/chat", label: "投资对话", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
];

function SidebarContent({
  pathname,
  onNavigate,
  showClose = false,
}: {
  pathname: string;
  onNavigate?: () => void;
  showClose?: boolean;
}) {
  return (
    <>
      <div className="mb-8 flex items-center justify-between gap-3 px-2">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1a1a1a] text-sm font-bold text-white">费</span>
          <span className="text-[15px] font-semibold tracking-tight">费曼星</span>
        </Link>
        {showClose ? (
          <button
            onClick={onNavigate}
            className="grid h-8 w-8 place-items-center rounded-lg text-[#6e6e73] transition-colors hover:bg-[#f2f2f3] hover:text-[#1a1a1a]"
            aria-label="关闭导航菜单"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : null}
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
                  ? "bg-[#f2f2f3] font-medium text-[#1a1a1a]"
                  : "text-[#6e6e73] hover:bg-[#f7f7f8] hover:text-[#1a1a1a]"
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

      <div className="mt-auto border-t border-[#e5e5e7] pt-3">
        <p className="px-3 text-xs text-[#8e8e93]">投资分析工具站</p>
        <p className="mt-1 px-3 text-xs text-[#8e8e93]">仅供研究参考</p>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [runningTaskKey, setRunningTaskKey] = useState<string | null>(null);

  useEffect(() => {
    const updateRunningTask = () => {
      const runningTask = getTasks().find(([, task]) => task.status === "running");
      setRunningTaskKey(runningTask?.[0] ?? null);
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
    <div className="min-h-screen bg-[#fafafa] md:flex">
      {runningTaskKey ? (
        <div
          className="fixed inset-x-0 top-0 z-[70] h-1 overflow-hidden bg-[#e5e5e7] md:left-56"
          title={{
            "pick-analysis": "AI选股分析中…",
            "review-analysis": "AI复盘分析中…",
            "chat-response": "AI回复中…",
          }[runningTaskKey] ?? "AI任务处理中…"}
        >
          <div className="h-full w-full animate-pulse bg-[#1a1a1a]" />
        </div>
      ) : null}

      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-[#e5e5e7] bg-white px-3 py-5 md:flex">
        <SidebarContent pathname={pathname} />
      </aside>

      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center border-b border-[#e5e5e7] bg-white px-4 md:hidden">
        <button
          onClick={() => setMenuOpen(true)}
          className="mr-3 grid h-8 w-8 place-items-center rounded-lg text-[#1a1a1a] transition-colors hover:bg-[#f2f2f3]"
          aria-label="打开导航菜单"
          aria-expanded={menuOpen}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[#1a1a1a] text-xs font-bold text-white">费</span>
          <span className="text-sm font-semibold">费曼星</span>
        </Link>
      </div>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-black/35"
            onClick={() => setMenuOpen(false)}
            aria-label="关闭导航菜单"
          />
          <aside className="relative z-[60] flex h-full w-[70%] max-w-xs flex-col bg-white px-3 py-5 shadow-2xl">
            <SidebarContent pathname={pathname} onNavigate={() => setMenuOpen(false)} showClose />
          </aside>
        </div>
      ) : null}

      <main className="min-w-0 flex-1 pt-12 md:pt-0">{children}</main>
    </div>
  );
}
