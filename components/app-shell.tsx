"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/", label: "首页", icon: "M3 12L12 3l9 9M5 10v10h14V10" },
  { href: "/chat", label: "AI对话", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
  { href: "/tools", label: "工具中心", icon: "M14.7 6.3a4 4 0 01-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 015.4-5.4l-2.5 2.5-1.5-1.5z" },
  { href: "/templates", label: "模板库", icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  { href: "/knowledge", label: "知识库", icon: "M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" },
  { href: "/pricing", label: "定价", icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" },
];

type SessionState =
  | { loading: true }
  | { loading: false; authenticated: boolean };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionState>({ loading: true });
  const isAuthPage = pathname === "/login" || pathname === "/register" || pathname.startsWith("/auth/");

  useEffect(() => {
    if (isAuthPage) return;
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { authenticated?: boolean }) => {
        if (active) setSession({ loading: false, authenticated: Boolean(payload.authenticated) });
      })
      .catch(() => active && setSession({ loading: false, authenticated: false }));
    return () => { active = false; };
  }, [isAuthPage, pathname]);

  if (isAuthPage) return <>{children}</>;

  const accountHref = !session.loading && session.authenticated ? "/dashboard" : "/login";
  const accountLabel = !session.loading && session.authenticated ? "用户中心" : "登录";

  return (
    <div className="flex h-screen overflow-hidden bg-[#f9fafb]">
      {/* Sidebar */}
      <aside className="flex w-[240px] flex-shrink-0 flex-col border-r border-[#e5e5e7] bg-white">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#1a1a1a] text-sm font-semibold text-white">费</span>
          <span>
            <span className="block text-sm font-semibold leading-4">费曼星</span>
            <span className="block text-[10px] leading-4 text-[#8e8e93]">AI 客服平台</span>
          </span>
        </Link>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-[#f2f2f3] font-medium text-[#1a1a1a]"
                    : "text-[#6e6e73] hover:bg-[#f7f7f8] hover:text-[#1a1a1a]"
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User card */}
        <div className="border-t border-[#e5e5e7] p-3">
          <Link href={accountHref} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[#f7f7f8]">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#f2f2f3] text-xs font-medium text-[#6e6e73]">
              {session.loading ? "…" : session.authenticated ? "户" : "客"}
            </span>
            <span>
              <span className="block text-sm font-medium leading-4">
                {session.loading ? "加载中" : session.authenticated ? "已登录" : "访客"}
              </span>
              <span className="block text-[10px] leading-4 text-[#8e8e93]">
                {session.loading ? "" : session.authenticated ? accountLabel : "点击登录"}
              </span>
            </span>
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
