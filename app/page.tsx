import Link from "next/link";

export const metadata = {
  title: "费曼星 · 投资分析工具",
};

const tools = [
  {
    number: "01",
    title: "AI选股助手",
    description: "输入美股代码，自动拉取实时行情数据，AI按选股框架出分析报告。",
    href: "/invest/pick",
    tags: ["实时行情", "财务指标", "AI分析"],
  },
  {
    number: "02",
    title: "交易复盘",
    description: "输入交易记录，AI做归因分析——盈亏来源、策略有效性、改进建议。",
    href: "/invest/review",
    tags: ["归因分析", "策略迭代", "风险复盘"],
  },
  {
    number: "03",
    title: "自选看板",
    description: "自选股实时监控+异动高亮+迷你走势图，一个页面看全局。",
    href: "/invest/dashboard",
    tags: ["实时监控", "异动高亮", "走势图"],
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
      {/* Hero */}
      <section className="mb-14">
        <p className="text-sm font-medium text-[#8e8e93]">费曼星 · 投资分析</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
          AI驱动的美股分析工具
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[#6e6e73]">
          选股、复盘、看板三件套。实时行情+财务数据+AI分析。
        </p>
      </section>

      {/* Tools */}
      <section className="mb-16">
        <h2 className="mb-6 text-lg font-semibold">工具</h2>
        <div className="grid gap-3">
          {tools.map((tool) => (
            <Link
              key={tool.number}
              href={tool.href}
              className="group flex items-start gap-5 rounded-2xl border border-[#e5e5e7] bg-white p-6 transition-colors hover:border-[#1a1a1a]"
            >
              <strong className="text-sm font-medium text-[#8e8e93]">{tool.number}</strong>
              <div className="flex-1">
                <h3 className="text-base font-semibold group-hover:text-[#1a1a1a]">{tool.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[#6e6e73]">{tool.description}</p>
                <div className="mt-3 flex gap-2">
                  {tool.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-[#f2f2f3] px-2 py-0.5 text-xs text-[#6e6e73]">{tag}</span>
                  ))}
                </div>
              </div>
              <span className="self-center text-lg text-[#8e8e93] transition-transform group-hover:translate-x-1">→</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Disclaimer */}
      <section className="rounded-2xl border border-[#e5e5e7] bg-[#f7f7f8] p-5">
        <p className="text-xs leading-6 text-[#8e8e93]">
          行情数据来自Yahoo Finance，可能存在15-20分钟延迟。所有数据和分析由AI生成，仅供研究参考，不构成任何投资建议。
        </p>
      </section>
    </div>
  );
}
