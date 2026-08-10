import Link from "next/link";

export const metadata = {
  title: "AI工具平台 · 多行业通用",
};

const tools = [
  {
    number: "01",
    title: "教培客服话术生成器",
    description: "输入机构、课程和家长问题，生成稳健、积极、温和三版成交话术。",
    href: "/tools/script-generator",
    tags: ["异议处理", "三版话术", "跟进建议"],
  },
  {
    number: "02",
    title: "高转化商品文案",
    description: "根据商品资料，一次生成平台化标题、正文、卖点和竞品摘要。",
    href: "/tools/product-copy",
    tags: ["五个标题", "三版正文", "平台适配"],
  },
  {
    number: "03",
    title: "AI对话",
    description: "基于知识库的智能客服，自动检索行业数据回答问题。",
    href: "/chat",
    tags: ["知识库检索", "多行业", "免费"],
  },
];

const industries = [
  { name: "宠物医院", docs: 98, color: "#f0fdf4", accent: "#16a34a" },
  { name: "教培", docs: 128, color: "#fffbeb", accent: "#d97706" },
  { name: "健身", docs: 136, color: "#eff6ff", accent: "#2563eb" },
  { name: "美发", docs: 78, color: "#fdf4ff", accent: "#c026d3" },
  { name: "通用方法论", docs: 271, color: "#f5f3ff", accent: "#7c3aed" },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl">
      <section className="px-6 pt-16 pb-12 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          让AI解决你的
          <br />
          <span className="text-[#8e8e93]">业务问题</span>
        </h1>
        <p className="mx-auto mt-5 max-w-md text-base text-[#6e6e73]">
          客服话术、商品文案、知识库问答
          <br />
          每个工具一个场景，3分钟出结果
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/chat" className="rounded-full bg-[#1a1a1a] px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90">
            免费开始
          </Link>
          <Link href="/tools" className="rounded-full border border-[#d1d1d6] px-6 py-2.5 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f7f7f8]">
            查看全部功能
          </Link>
        </div>
      </section>

      <section className="px-6 pb-10">
        <div className="grid gap-4 sm:grid-cols-3">
          <Link href="/chat" className="group rounded-2xl border border-[#e5e5e7] bg-white p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.03]">
            <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-[#f7f7f8]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
            </div>
            <h3 className="text-base font-semibold">AI 对话</h3>
            <p className="mt-1.5 text-sm leading-6 text-[#6e6e73]">基于711条行业知识库的智能客服</p>
            <span className="mt-3 inline-block text-xs text-[#8e8e93] transition-transform group-hover:translate-x-0.5">开始对话 →</span>
          </Link>
          <Link href="/tools" className="group rounded-2xl border border-[#e5e5e7] bg-white p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.03]">
            <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-[#f7f7f8]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14.7 6.3a4 4 0 01-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 015.4-5.4l-2.5 2.5-1.5-1.5z" /></svg>
            </div>
            <h3 className="text-base font-semibold">工具中心</h3>
            <p className="mt-1.5 text-sm leading-6 text-[#6e6e73]">话术生成、文案撰写，结构化输出</p>
            <span className="mt-3 inline-block text-xs text-[#8e8e93] transition-transform group-hover:translate-x-0.5">查看工具 →</span>
          </Link>
          <Link href="/knowledge" className="group rounded-2xl border border-[#e5e5e7] bg-white p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.03]">
            <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-[#f7f7f8]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>
            </div>
            <h3 className="text-base font-semibold">知识库</h3>
            <p className="mt-1.5 text-sm leading-6 text-[#6e6e73]">5个行业，711条真实数据，开箱即用</p>
            <span className="mt-3 inline-block text-xs text-[#8e8e93] transition-transform group-hover:translate-x-0.5">查看详情 →</span>
          </Link>
        </div>
      </section>

      <section className="px-6 pb-10">
        <h2 className="mb-5 text-xs font-medium uppercase tracking-wider text-[#8e8e93]">核心工具</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {tools.map((tool) => (
            <Link key={tool.href} href={tool.href} className="group rounded-2xl border border-[#e5e5e7] bg-white p-5 transition-all hover:border-[#1a1a1a]/20 hover:shadow-lg hover:shadow-black/[0.03]">
              <div className="flex items-center justify-between text-xs text-[#8e8e93]">
                <span className="font-medium">{tool.number}</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
              <h3 className="mt-5 text-sm font-semibold">{tool.title}</h3>
              <p className="mt-2 text-xs leading-5 text-[#6e6e73]">{tool.description}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {tool.tags.map((tag) => (
                  <span key={tag} className="rounded-md bg-[#f7f7f8] px-2 py-0.5 text-[10px] text-[#6e6e73]">{tag}</span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="px-6 pb-16">
        <h2 className="mb-5 text-xs font-medium uppercase tracking-wider text-[#8e8e93]">系统知识库</h2>
        <div className="rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold">5个行业 · 711条数据</p>
              <p className="mt-1 text-sm text-[#8e8e93]">8个知识库文件，全部带来源URL交叉验证</p>
            </div>
            <Link href="/knowledge" className="text-sm text-[#6e6e73] transition-colors hover:text-[#1a1a1a]">查看详情 →</Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-5">
            {industries.map((ind) => (
              <div key={ind.name} className="rounded-xl border border-[#e5e5e7] p-4" style={{ background: ind.color }}>
                <div className="mb-2 h-1 w-8 rounded-full" style={{ background: ind.accent }} />
                <p className="text-sm font-medium">{ind.name}</p>
                <p className="mt-0.5 text-xs text-[#8e8e93]">{ind.docs} 条数据</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
