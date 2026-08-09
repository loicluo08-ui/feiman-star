"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navigationItems = [
  { href: "/", label: "首页" },
  { href: "/tools", label: "功能" },
  { href: "/pricing", label: "定价" },
  { href: "/knowledge", label: "知识库" },
];

type SessionState =
  | { loading: true }
  | { loading: false; authenticated: boolean };

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="主导航" className="flex flex-col gap-1 md:flex-row md:items-center md:gap-1">
      {navigationItems.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`focus-ring rounded-lg px-3 py-2 text-sm transition-colors ${
              active ? "bg-[#f2f2f3] font-medium text-[#1a1a1a]" : "text-[#6e6e73] hover:bg-[#f7f7f8] hover:text-[#1a1a1a]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
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
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 border-b border-[#e5e5e7] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="focus-ring flex items-center gap-2.5 rounded-lg" aria-label="费曼星首页">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-[#1a1a1a] text-sm font-semibold text-white">费</span>
            <span>
              <span className="block text-sm font-semibold leading-4">费曼星</span>
              <span className="block text-[10px] leading-4 text-[#8e8e93]">AI 客服平台</span>
            </span>
          </Link>

          <div className="hidden items-center gap-3 md:flex">
            <Navigation />
            <Link href={accountHref} className="focus-ring ml-2 rounded-lg bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-white">
              {session.loading ? "登录" : accountLabel}
            </Link>
          </div>

          <button
            type="button"
            aria-label={menuOpen ? "关闭导航" : "打开导航"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
            className="focus-ring grid h-10 w-10 place-items-center rounded-lg border border-[#e5e5e7] md:hidden"
          >
            <span aria-hidden>{menuOpen ? "×" : "☰"}</span>
          </button>
        </div>

        {menuOpen ? (
          <div className="border-t border-[#e5e5e7] bg-white px-5 py-4 md:hidden">
            <Navigation onNavigate={() => setMenuOpen(false)} />
            <Link href={accountHref} onClick={() => setMenuOpen(false)} className="focus-ring mt-3 block rounded-lg bg-[#1a1a1a] px-4 py-2.5 text-center text-sm font-medium text-white">
              {session.loading ? "登录" : accountLabel}
            </Link>
          </div>
        ) : null}
      </header>

      <main>{children}</main>
    </div>
  );
}
