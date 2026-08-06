"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navigationItems = [
  { href: "/", label: "首页", short: "首" },
  { href: "/chat", label: "AI对话", short: "聊" },
  { href: "/tools", label: "工具中心", short: "具" },
  { href: "/templates", label: "模板库", short: "模" },
  { href: "/knowledge", label: "知识库", short: "知" },
  { href: "/pricing", label: "定价", short: "价" },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="主导航" className="space-y-1">
      {navigationItems.map((item) => {
        const active =
          pathname === item.href ||
          (item.href === "/tools" && pathname.startsWith("/tools/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`focus-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              active ? "bg-white font-medium shadow-sm" : "text-neutral-600 hover:bg-white/70"
            }`}
          >
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg border border-neutral-200 bg-white text-xs">
              {item.short}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-[#e5e5e7] bg-[#f7f7f8] p-4 lg:flex lg:flex-col">
        <Link href="/" className="focus-ring mb-8 flex items-center gap-3 rounded-lg px-2 py-1.5">
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-[#1a1a1a] text-sm font-semibold text-white">
            费
          </span>
          <span>
            <span className="block text-sm font-semibold">费曼星</span>
            <span className="block text-xs text-[#8e8e93]">AI 工具平台</span>
          </span>
        </Link>
        <Navigation />
        <div className="mt-auto border-t border-[#e5e5e7] px-2 pt-4 text-xs leading-5 text-[#8e8e93]">
          P0 · 两工具完整闭环
          <br />
          DeepSeek · 服务端直连
        </div>
      </aside>

      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-[#e5e5e7] bg-white/90 px-5 backdrop-blur lg:hidden">
        <Link href="/" className="focus-ring flex items-center gap-2 rounded-lg">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-[#1a1a1a] text-xs font-semibold text-white">
            费
          </span>
          <span className="text-sm font-semibold">费曼星</span>
        </Link>
        <button
          type="button"
          aria-label={menuOpen ? "关闭导航" : "打开导航"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
          className="focus-ring grid h-10 w-10 place-items-center rounded-lg border border-[#e5e5e7] bg-white"
        >
          <span aria-hidden className="text-lg leading-none">{menuOpen ? "×" : "☰"}</span>
        </button>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            aria-label="关闭导航遮罩"
            className="absolute inset-0 bg-black/20"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[min(84vw,320px)] border-r border-[#e5e5e7] bg-[#f7f7f8] p-5 shadow-xl">
            <div className="mb-8 flex items-center justify-between">
              <span className="font-semibold">费曼星</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="focus-ring grid h-9 w-9 place-items-center rounded-lg border border-[#e5e5e7] bg-white"
                aria-label="关闭导航"
              >
                ×
              </button>
            </div>
            <Navigation onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      ) : null}

      <main className="lg:pl-60">{children}</main>
    </div>
  );
}
