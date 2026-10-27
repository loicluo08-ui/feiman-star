import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "财报日历 · 费曼星",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
