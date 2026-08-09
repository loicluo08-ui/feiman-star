import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

const demos = {
  "pet-hospital": {
    name: "宠物医院",
    title: "宠物医院 AI 客服 Demo",
    description: "基于门店服务说明，回答常见问诊前咨询，并识别需要人工或线下就医的情况。",
    question: "猫咪第一次打疫苗，需要提前做什么准备？",
    answer: "建议先确认猫咪已满8周龄，近期精神、食欲和排便正常，并且完成基础驱虫。接种当天请带好免疫记录，避免洗澡和长途运输。如果有呕吐、腹泻或发热，请先由医生评估，再决定是否接种。需要我帮你预约到院时间吗？",
    source: "门店疫苗接种须知.pdf",
  },
  education: {
    name: "教培机构",
    title: "教培机构 AI 客服 Demo",
    description: "结合课程、师资与价格资料，为家长提供准确回答并自然推进试听。",
    question: "孩子5岁零基础，钢琴课怎么收费？之前学过半年没兴趣了。",
    answer: "5岁零基础可以从启蒙一对一开始，单课时为120–180元，具体会根据老师级别和课包确定。之前学过但兴趣不足很常见，试听时老师会先观察孩子的节奏感和接受方式，再用游戏化练习找到兴趣点。可以先安排一次试听，不急着决定长期课包。",
    source: "星韵钢琴课程与试听政策.md",
  },
  "local-service": {
    name: "本地服务",
    title: "本地服务 AI 客服 Demo",
    description: "及时回答预约、报价和服务范围问题，让门店闭店后仍然能够承接线索。",
    question: "周末可以预约上门清洗空调吗？两台挂机大概多少钱？",
    answer: "周六、周日都可以预约。两台常规壁挂式空调基础清洗参考价为198元，若需要深度拆洗，师傅会在上门检查后说明差价，确认后才施工。请告诉我所在小区和方便的时间段，我可以先为你登记。",
    source: "上门服务项目与报价.txt",
  },
} as const;

type Industry = keyof typeof demos;

export function generateStaticParams() {
  return Object.keys(demos).map((industry) => ({ industry }));
}

export function generateMetadata({ params }: { params: { industry: string } }): Metadata {
  const demo = demos[params.industry as Industry];
  return { title: demo?.title ?? "行业 Demo" };
}

export default function IndustryDemoPage({ params }: { params: { industry: string } }) {
  const demo = demos[params.industry as Industry];
  if (!demo) notFound();

  return (
    <div className="mx-auto min-h-[calc(100vh-4rem)] max-w-4xl px-5 py-14 sm:px-8 sm:py-20">
      <Link href="/#industries" className="focus-ring rounded text-sm text-[#6e6e73] hover:text-[#1a1a1a]">← 返回行业方案</Link>
      <header className="mt-8 max-w-2xl">
        <span className="inline-flex rounded-full bg-[#f2f2f3] px-3 py-1 text-xs font-medium text-[#6e6e73]">{demo.name} · 独立 Demo</span>
        <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em]">{demo.title}</h1>
        <p className="mt-4 text-sm leading-7 text-[#6e6e73]">{demo.description}</p>
      </header>

      <section className="mt-10 rounded-2xl border border-[#e5e5e7] bg-[#f7f7f8] p-5 sm:p-7" aria-label="客服对话示例">
        <article className="ml-auto max-w-[85%] rounded-2xl bg-[#1a1a1a] px-4 py-3 text-sm leading-7 text-white">{demo.question}</article>
        <article className="mt-4 max-w-[90%] rounded-2xl border border-[#e5e5e7] bg-white px-4 py-3 text-sm leading-7">
          <p>{demo.answer}</p>
          <p className="mt-3 border-t border-[#e5e5e7] pt-2 text-xs text-[#8e8e93]">参考来源：{demo.source}</p>
        </article>
      </section>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/register" className="focus-ring rounded-xl bg-[#1a1a1a] px-5 py-3 text-sm font-medium text-white">创建我的AI客服</Link>
        <Link href="/pricing" className="focus-ring rounded-xl border border-[#d1d1d6] px-5 py-3 text-sm font-medium hover:border-[#1a1a1a]">查看定价</Link>
      </div>
      <p className="mt-5 text-xs leading-5 text-[#8e8e93]">以上为场景演示，正式使用时回答将基于您上传的专属资料生成。</p>
    </div>
  );
}
