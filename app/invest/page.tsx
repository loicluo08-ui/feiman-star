import Link from "next/link";

// 10/1 P2-9命名统一：同一板块三处三名实锤（AI对话vs投资对话/财经日历vs财报日历/选股三叫）——
// 术语对齐侧边导航+主页卡片；顺序对齐导航（快讯/市场/财报/AI选股/复盘/对话），判断账本入口补齐（六轮检测P2-5）
const FEATURES = [
  {
    href: "/invest/flash",
    title: "实时快讯",
    desc: "华尔街见闻 + 金十合并流，分钟级更新",
  },
  {
    href: "/invest/market",
    title: "市场快报",
    desc: "自选行情 + 板块轮动（1d/5d/20d）+ 市场情绪",
  },
  {
    href: "/invest/calendar",
    title: "财报日历",
    desc: "财报日期查询（±2周窗口），提前排雷",
  },
  {
    href: "/invest/pick",
    title: "AI选股",
    desc: "输入代码或名称，查行情、估值、K线与AI解读",
  },
  {
    href: "/invest/review",
    title: "交易复盘",
    desc: "录入成交流水，FIFO统计盈亏 + AI归因分析",
  },
  {
    href: "/invest/chat",
    title: "投资对话",
    desc: "带知识库的投资问答，支持截图/图表提问",
  },
  {
    href: "/invest/ledger",
    title: "判断账本",
    desc: "AI主判断存档与机械结算——错的可见性就是信任来源",
  },
];

export default function InvestHome() {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
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
