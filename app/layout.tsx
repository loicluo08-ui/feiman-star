import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: {
    default: "费曼星 · 投资分析工具",
    template: "%s · 费曼星",
  },
  description: "AI驱动的美股分析工具——选股分析、交易复盘、投资对话。行情来自腾讯实时接口，仅供研究参考，不构成投资建议。",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
  },
  openGraph: {
    title: "费曼星 · 投资分析工具",
    description: "AI驱动的美股分析工具——选股分析、交易复盘、投资对话。行情来自腾讯实时接口，仅供研究参考，不构成投资建议。",
    type: "website",
    locale: "zh_CN",
    siteName: "费曼星",
  },
  twitter: {
    card: "summary",
    title: "费曼星 · 投资分析工具",
    description: "AI驱动的美股分析工具——选股分析、交易复盘、投资对话。",
  },
};

const themeScript = `
  (function () {
    try {
      var saved = localStorage.getItem("feimanstar_theme");
      var theme = saved === "dark" || saved === "light"
        ? saved
        : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch (_) {}
  })();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
        <footer className="border-t border-[var(--border)] px-6 py-4 text-center">
          <p className="text-xs text-[var(--text-muted)]">
            费曼星 · 投资分析工具 · 行情来自腾讯实时接口 · 仅供研究参考，不构成投资建议
          </p>
        </footer>
      </body>
    </html>
  );
}
