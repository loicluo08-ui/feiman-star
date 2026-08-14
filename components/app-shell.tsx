"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "首页", icon: "M3 12L12 3l9 9M5 10v10h14V10" },
  { href: "/invest/pick", label: "AI选股", icon: "M3 3v18h18M7 14l4-4 4 4 5-5" },
  { href: "/invest/review", label: "交易复盘", icon: "M9 17v-6h4v6M7 7h10v10H7zM5 5h14v14H5z" },
  { href: "/invest/dashboard", label: "自选看板", icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-[#fafafa]">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-[#e5e5e7] bg-white px-3 py-5 sm:flex">
        <Link href="/" className="mb-8 flex items-center gap-2.5 px-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1a1a1a] text-sm font-bold text-white">费</span>
          <span className="text-[15px] font-semibold tracking-tight">费曼星</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5">
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
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
          <p className="px-3 mt-1 text-xs text-[#8e8e93]">仅供研究参考</p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-[#e5e5e7] bg-white px-4 sm:hidden">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-[#1a1a1a] text-xs font-bold text-white">费</span>
        <span className="text-sm font-semibold">费曼星</span>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
