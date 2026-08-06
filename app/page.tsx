import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "工具首页" };

const tools = [
  {
    number: "01",
    title: "教培客服话术生成器",
    description: "根据机构真实信息和家长问题，准备三种成交策略与跟进建议。",
    href: "/tools/script-generator",
    tags: ["三版话术", "异议处理", "跟进建议"],
  },
  {
    number: "02",
    title: "高转化商品文案",
    description: "针对淘宝、拼多多和抖音，生成平台化标题、正文与卖点提炼。",
    href: "/tools/product-copy",
    tags: ["5 个标题", "三版正文", "平台适配"],
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-12 sm:px-8 lg:px-12 lg:py-20">
      <div className="max-w-3xl">
        <span className="inline-flex rounded-full border border-[#e5e5e7] px-3 py-1 text-xs text-[#8e8e93]">P0 · 两个核心工具</span>
        <h1 className="mt-7 text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">把 AI 变成真正好用的业务工具。</h1>
        <p className="mt-6 max-w-2xl text-base leading-8 text-[#8e8e93] sm:text-lg">
          不需要写 Prompt。填写真实业务信息，即可获得经过结构校验的完整结果。
        </p>
      </div>

      <section aria-labelledby="tools-heading" className="mt-14">
        <div className="flex items-end justify-between gap-4 border-b border-[#e5e5e7] pb-4">
          <h2 id="tools-heading" className="text-lg font-semibold">
            选择工具
          </h2>
          <span className="text-xs text-[#8e8e93]">2 个工具</span>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="focus-ring group rounded-xl border border-[#e5e5e7] bg-white p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_16px_45px_rgba(0,0,0,0.06)] sm:p-7"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs font-medium tracking-wider text-[#8e8e93]">{tool.number}</span>
                <span aria-hidden className="text-lg transition-transform group-hover:translate-x-1">
                  →
                </span>
              </div>
              <h3 className="mt-12 text-xl font-semibold tracking-tight">{tool.title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#8e8e93]">{tool.description}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {tool.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-[#f7f7f8] px-3 py-1.5 text-xs text-neutral-600">
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <footer className="mt-auto pt-16 text-xs text-[#8e8e93]">费曼星 · 场景化 AI 工具平台</footer>
    </div>
  );
}
