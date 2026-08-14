import Link from "next/link";

export const metadata = {
  title: "费曼星 · 投资分析工具",
};

const tools = [
  {
    number: "01",
    title: "市场快报",
    description: "实时大盘指数+11个板块涨跌+市场情绪判断，30秒自动刷新。",
    href: "/invest/market",
    tags: ["实时", "大盘", "板块轮动"],
  },
  {
    number: "02",
    title: "财报日历",
    description: "按日期查看本周美股财报安排，快速筛选代码、EPS预期与盘前盘后时间。",
    href: "/invest/calendar",
    tags: ["本周财报", "EPS预期", "事件跟踪"],
  },
  {
    number: "03",
    title: "AI选股助手",
    description: "输入美股代码或公司名，拉取行情+24个财务指标，AI生成6维度分析报告。",
    href: "/invest/pick",
    tags: ["财务指标", "AI分析", "6维度评分"],
  },
  {
    number: "04",
    title: "交易复盘",
    description: "输入交易记录，AI做归因分析——盈亏来源、策略有效性、行为偏差、改进建议。",
    href: "/invest/review",
    tags: ["归因分析", "策略评估", "行为偏差"],
  },
  {
    number: "05",
    title: "投资对话",
    description: "发文字或截图，AI帮你分析。K线图/财报/持仓截图都能读，支持多轮对话。",
    href: "/invest/chat",
    tags: ["截图分析", "多轮对话", "GLM-4V"],
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
      {/* Hero */}
      <section className="mb-14">
        <p className="text-sm font-medium text-[var(--text-muted)]">费曼星 · 投资分析</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
          AI驱动的美股分析工具
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--text-secondary)]">
          选股分析+交易复盘。行情数据来自Yahoo Finance，可能存在15-20分钟延迟。实时行情请用专业终端。
        </p>
      </section>

      {/* Tools */}
      <section className="mb-16">
        <div className="grid gap-4 sm:grid-cols-2">
          {tools.map((tool) => (
            <Link
              key={tool.number}
              href={tool.href}
              className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 transition-all hover:border-[var(--text)] hover:shadow-sm"
            >
              <strong className="mb-3 block text-xs text-[var(--text-muted)]">{tool.number}</strong>
              <h3 className="text-lg font-semibold group-hover:text-[var(--text)]">{tool.title}</h3>
              <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{tool.description}</p>
              <div className="mt-3 flex gap-2">
                {tool.tags.map((tag) => (
                  <span key={tag} className="rounded-md bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{tag}</span>
                ))}
              </div>
              <span className="mt-4 block text-sm text-[var(--text-muted)] transition-transform group-hover:translate-x-1">→</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Disclaimer */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
        <p className="text-xs leading-6 text-[var(--text-muted)]">
          行情数据来自Yahoo Finance，可能存在15-20分钟延迟。所有数据和分析由AI生成，仅供研究参考，不构成任何投资建议。
        </p>
      </section>
    </div>
  );
}
