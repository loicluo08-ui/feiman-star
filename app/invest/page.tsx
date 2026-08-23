import Link from "next/link";

const FEATURES = [
  {
    href: "/invest/pick",
    title: "选股",
    desc: "输入代码或名称，查行情、估值、K线与AI解读",
  },
  {
    href: "/invest/market",
    title: "市场快报",
    desc: "自选行情 + 板块轮动（1d/5d/20d）+ 市场情绪",
  },
  {
    href: "/invest/chat",
    title: "AI对话",
    desc: "带知识库的投资问答，支持截图/图表提问",
  },
  {
    href: "/invest/review",
    title: "交易复盘",
    desc: "录入成交流水，FIFO统计盈亏 + AI归因分析",
  },
  {
    href: "/invest/calendar",
    title: "财经日历",
    desc: "财报日期查询（±2周窗口），提前排雷",
  },
  {
    href: "/invest/flash",
    title: "实时快讯",
    desc: "华尔街见闻 + 财联社合并流，分钟级更新",
  },
];

export default function InvestHome() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">费曼星 · 投资工作台</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          数据尽量实时，判断尽量交叉，结论自己负责
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            className="group rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5 transition-colors hover:border-[var(--text)]"
          >
            <h2 className="text-base font-semibold tracking-tight">
              {f.title}
              <span className="ml-1.5 inline-block text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </h2>
            <p className="mt-1.5 text-sm text-[var(--text-secondary)]">{f.desc}</p>
          </Link>
        ))}
      </div>

      <footer className="mt-10 text-xs text-[var(--text-muted)]">
        行情来源：腾讯财经 / stockanalysis.com / Finnhub（多源容灾） · 数据延迟以页面标注为准
      </footer>
    </div>
  );
}
