import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "判断账本 · 费曼星",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
