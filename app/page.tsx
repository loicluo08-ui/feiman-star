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
  { name: "宠物医院", docs: 98, color: "#f0fdf4" },
  { name: "教培", docs: 128, color: "#fffbeb" },
  { name: "健身", docs: 136, color: "#eff6ff" },
  { name: "美发", docs: 78, color: "#fdf4ff" },
  { name: "通用方法论", docs: 271, color: "#f5f3ff" },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Hero */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">让AI解决你的业务问题</h1>
        <p className="mt-2 text-sm text-[#6e6e73]">
          客服话术、商品文案、知识库问答——每个工具一个场景，3分钟出结果
        </p>
      </div>

      {/* Quick actions */}
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Link
          href="/chat"
          className="group rounded-xl border border-[#e5e5e7] bg-white p-4 transition-all hover:border-[#1a1a1a] hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">开始对话</span>
            <span className="text-[#8e8e93] transition-transform group-hover:translate-x-1">→</span>
          </div>
          <p className="mt-1 text-xs text-[#8e8e93]">基于知识库的AI客服</p>
        </Link>
        <Link
          href="/tools"
          className="group rounded-xl border border-[#e5e5e7] bg-white p-4 transition-all hover:border-[#1a1a1a] hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">工具中心</span>
            <span className="text-[#8e8e93] transition-transform group-hover:translate-x-1">→</span>
          </div>
          <p className="mt-1 text-xs text-[#8e8e93]">话术生成、文案撰写</p>
        </Link>
        <Link
          href="/knowledge"
          className="group rounded-xl border border-[#e5e5e7] bg-white p-4 transition-all hover:border-[#1a1a1a] hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">知识库</span>
            <span className="text-[#8e8e93] transition-transform group-hover:translate-x-1">→</span>
          </div>
          <p className="mt-1 text-xs text-[#8e8e93]">711条行业数据</p>
        </Link>
      </div>

      {/* Tools */}
      <div className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-[#8e8e93]">核心工具</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group rounded-xl border border-[#e5e5e7] bg-white p-5 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center justify-between text-xs text-[#8e8e93]">
                <span>{tool.number}</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
              <h3 className="mt-4 text-sm font-semibold">{tool.title}</h3>
              <p className="mt-2 text-xs leading-5 text-[#6e6e73]">{tool.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tool.tags.map((tag) => (
                  <span key={tag} className="rounded-md bg-[#f7f7f8] px-2 py-0.5 text-[10px] text-[#6e6e73]">
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Knowledge base stats */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-[#8e8e93]">系统知识库</h2>
        <div className="rounded-xl border border-[#e5e5e7] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">5个行业 · 711条数据 · 8个文件</p>
            <Link href="/knowledge" className="text-xs text-[#6e6e73] hover:text-[#1a1a1a]">
              查看详情 →
            </Link>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            {industries.map((ind) => (
              <div
                key={ind.name}
                className="rounded-lg border border-[#e5e5e7] px-3 py-2.5"
                style={{ background: ind.color }}
              >
                <p className="text-xs font-medium">{ind.name}</p>
                <p className="mt-0.5 text-[10px] text-[#8e8e93]">{ind.docs} 条</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
