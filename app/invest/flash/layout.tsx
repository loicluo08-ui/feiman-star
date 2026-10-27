import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "实时快讯 · 费曼星",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
