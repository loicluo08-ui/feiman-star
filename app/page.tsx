import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "AI客服平台 · 多行业通用" };

const industries = [
  {
    eyebrow: "宠物医院",
    title: "让每一次问诊咨询都有回应",
    description: "自动解答疫苗、绝育、体检与营业时间问题，复杂病情及时引导人工接诊。",
    href: "/demos/pet-hospital",
    sample: "猫咪第一次打疫苗，需要提前做什么准备？",
  },
  {
    eyebrow: "教培机构",
    title: "从家长咨询到试听邀约",
    description: "理解课程、师资、价格与退费政策，用机构真实资料生成准确、有温度的回复。",
    href: "/demos/education",
    sample: "孩子5岁零基础，钢琴课怎么收费？",
  },
  {
    eyebrow: "本地服务",
    title: "把重复咨询交给AI客服",
    description: "覆盖预约、报价、服务范围与售后说明，让门店在非营业时间也不错过客户。",
    href: "/demos/local-service",
    sample: "周末可以预约上门清洗空调吗？",
  },
];

export default function HomePage() {
  return (
    <div>
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-20 sm:px-8 sm:pb-28 sm:pt-28">
        <div className="max-w-4xl">
          <span className="inline-flex rounded-full border border-[#e5e5e7] bg-[#fafafa] px-3 py-1 text-xs font-medium text-[#6e6e73]">
            AI客服平台 · 多行业通用
          </span>
          <h1 className="mt-7 text-5xl font-semibold tracking-[-0.055em] sm:text-7xl">
            懂你的业务，<br />也懂你的客户。
          </h1>
          <p className="mt-7 max-w-2xl text-base leading-8 text-[#6e6e73] sm:text-lg">
            上传业务资料，费曼星就能基于你的专属知识库接待咨询、生成内容并持续服务。无需编写 Prompt。
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/register" className="focus-ring rounded-xl bg-[#1a1a1a] px-5 py-3 text-sm font-medium text-white">免费开始使用</Link>
            <Link href="/tools" className="focus-ring rounded-xl border border-[#d1d1d6] px-5 py-3 text-sm font-medium hover:border-[#1a1a1a]">查看全部功能</Link>
          </div>
        </div>
      </section>

      <section id="industries" aria-labelledby="industries-title" className="border-y border-[#e5e5e7] bg-[#f7f7f8]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-[#8e8e93]">行业解决方案</p>
            <h2 id="industries-title" className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">一个平台，服务不同生意。</h2>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {industries.map((industry, index) => (
              <Link key={industry.href} href={industry.href} className="focus-ring group flex min-h-[320px] flex-col rounded-2xl border border-[#e5e5e7] bg-white p-6 transition-all hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(0,0,0,0.07)]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium tracking-[0.16em] text-[#8e8e93]">0{index + 1}</span>
                  <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
                </div>
                <p className="mt-12 text-sm font-medium text-[#6e6e73]">{industry.eyebrow}</p>
                <h3 className="mt-2 text-xl font-semibold tracking-tight">{industry.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#8e8e93]">{industry.description}</p>
                <div className="mt-auto rounded-xl bg-[#f7f7f8] p-4 text-sm leading-6 text-[#6e6e73]">“{industry.sample}”</div>
                <span className="mt-5 text-sm font-medium">体验独立 Demo →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-20 sm:px-8 md:grid-cols-[1fr_auto] md:items-center sm:py-24">
        <div>
          <p className="text-sm font-medium text-[#8e8e93]">从资料到回答</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.035em]">把自己的业务知识，变成随时在线的AI客服。</h2>
        </div>
        <Link href="/knowledge" className="focus-ring rounded-xl border border-[#d1d1d6] px-5 py-3 text-center text-sm font-medium hover:border-[#1a1a1a]">建立专属知识库</Link>
      </section>

      <footer className="border-t border-[#e5e5e7] bg-[#fafafa]">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-10 text-sm text-[#6e6e73] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="font-medium text-[#1a1a1a]">费曼星 · AI客服平台</p>
            <p className="mt-1 text-xs">让每一家小企业都拥有自己的AI客服。</p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            <Link href="/pricing" className="hover:text-[#1a1a1a]">套餐与定价</Link>
            <Link href="/login" className="hover:text-[#1a1a1a]">登录平台</Link>
            <a href="https://github.com/loicluo08-ui/feiman-star" target="_blank" rel="noreferrer" className="hover:text-[#1a1a1a]">联系费曼星</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
