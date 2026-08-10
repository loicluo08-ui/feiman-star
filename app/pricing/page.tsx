import Link from "next/link";

const plans = [
  {
    name: "体验版",
    price: "¥0",
    unit: "长期有效",
    audience: "先体验核心能力",
    calls: "15次/天",
    featured: false,
  },
  {
    name: "Lite",
    price: "¥9.9",
    unit: "30天",
    audience: "个人与小微商家",
    calls: "50次/天",
    featured: false,
  },
  {
    name: "Pro",
    price: "¥29",
    unit: "30天",
    audience: "高频经营者",
    calls: "200次/天",
    featured: true,
  },
  {
    name: "VIP",
    price: "¥99",
    unit: "30天",
    audience: "团队与重度使用",
    calls: "不限次数",
    featured: false,
  },
] as const;

const comparisons = [
  { label: "每日AI次数", values: ["15次", "50次", "200次", "不限"] },
  { label: "系统知识库", values: ["12行业", "12行业", "12行业", "12行业"] },
  { label: "专属知识库", values: ["最多10个文档", "最多10个文档", "最多10个文档", "最多10个文档"] },
  { label: "场景工具", values: ["2个核心工具", "2个核心工具", "2个核心工具", "2个核心工具"] },
  { label: "行业模板", values: ["标准模板", "完整模板", "完整模板", "完整模板"] },
  { label: "使用期限", values: ["长期有效", "30天", "30天", "30天"] },
] as const;

const faqs = [
  {
    question: "额度用完怎么办？",
    answer: "体验版额度会在次日00:00自动恢复；付费套餐也按日刷新。需要更高额度时，可兑换更高套餐。",
  },
  {
    question: "兑换码能退款吗？",
    answer: "兑换码一经兑换即绑定当前账号，不能重复使用。未兑换订单的退款请联系原购买渠道处理。",
  },
  {
    question: "上传资料安全吗？",
    answer: "资料仅用于当前账号的知识检索，接口密钥只保存在服务端。你可以随时在知识库中删除文档。",
  },
  {
    question: "费曼星和直接使用DeepSeek有什么区别？",
    answer: "费曼星把行业知识、任务流程和输出结构预先编码成场景工具，让不懂提示词的人也能直接完成具体工作。",
  },
] as const;

export const metadata = { title: "定价" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
      <section className="text-center">
        <p className="text-sm font-medium text-[#8e8e93]">简单透明</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">按需要选择，不为复杂功能买单</h1>
        <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-7 text-[#6e6e73]">所有套餐都可以使用费曼星核心工具与12行业系统知识库，差别主要是每日调用额度。</p>
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="套餐价格">
        {plans.map((plan) => (
          <article key={plan.name} className={`relative flex min-h-72 flex-col rounded-2xl border bg-white p-6 ${plan.featured ? "border-[#1a1a1a] ring-1 ring-[#1a1a1a]" : "border-[#e5e5e7]"}`}>
            {plan.featured ? <span className="absolute right-4 top-4 rounded-lg bg-[#1a1a1a] px-2.5 py-1 text-[11px] font-medium text-white">推荐</span> : null}
            <h2 className="text-lg font-semibold">{plan.name}</h2>
            <p className="mt-2 text-sm text-[#8e8e93]">{plan.audience}</p>
            <p className="mt-7 text-4xl font-semibold tracking-[-0.04em]">{plan.price}</p>
            <p className="mt-1 text-xs text-[#8e8e93]">{plan.unit}</p>
            <div className="mt-7 rounded-xl bg-[#f7f7f8] px-4 py-3 text-sm"><span className="text-[#6e6e73]">AI额度</span><strong className="float-right font-medium">{plan.calls}</strong></div>
            <Link href={plan.name === "体验版" ? "/register" : "/dashboard"} className={`focus-ring mt-auto block rounded-xl px-4 py-3 text-center text-sm font-medium ${plan.featured ? "bg-[#1a1a1a] text-white" : "bg-[#f0f0f2] text-[#1a1a1a]"}`}>{plan.name === "体验版" ? "免费开始" : "兑换套餐"}</Link>
          </article>
        ))}
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">功能对比</h2>
        <div className="mt-6 overflow-hidden rounded-2xl border border-[#e5e5e7]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[#f7f7f8]"><tr><th className="p-4 font-medium">功能</th>{plans.map((plan) => <th key={plan.name} className="p-4 font-medium">{plan.name}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#e5e5e7]">{comparisons.map((row) => <tr key={row.label}><th className="p-4 font-medium">{row.label}</th>{row.values.map((value, index) => <td key={`${row.label}-${plans[index].name}`} className="p-4 text-[#5b5b60]">{value}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mt-16 grid gap-8 rounded-2xl bg-[#f7f7f8] p-7 sm:p-9 lg:grid-cols-[0.8fr_1.2fr]">
        <div><p className="text-sm font-medium text-[#8e8e93]">兑换说明</p><h2 className="mt-2 text-2xl font-semibold">购买后，三步生效</h2></div>
        <ol className="space-y-4 text-sm leading-7 text-[#454547]">
          <li><strong className="mr-3 text-[#1a1a1a]">01</strong>从官方销售渠道购买对应套餐兑换码。</li>
          <li><strong className="mr-3 text-[#1a1a1a]">02</strong>登录费曼星，在用户中心输入兑换码。</li>
          <li><strong className="mr-3 text-[#1a1a1a]">03</strong>兑换成功后套餐与额度立即更新，有效期从兑换时开始计算。</li>
        </ol>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">常见问题</h2>
        <div className="mt-6 divide-y divide-[#e5e5e7] border-y border-[#e5e5e7]">{faqs.map((faq) => <details key={faq.question} className="group py-5"><summary className="focus-ring flex cursor-pointer list-none items-center justify-between rounded-lg font-medium"><span>{faq.question}</span><span className="text-xl font-light text-[#8e8e93] transition-transform group-open:rotate-45">＋</span></summary><p className="max-w-3xl pt-3 text-sm leading-7 text-[#6e6e73]">{faq.answer}</p></details>)}</div>
      </section>
    </div>
  );
}
