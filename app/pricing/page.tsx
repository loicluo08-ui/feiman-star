const plans = [
  { name: "免费版", price: "¥0", unit: "/永久", desc: "适合试用体验", features: ["每日15次AI对话", "基础工具使用", "预置行业知识库"], disabled: ["自定义模板", "知识库上传", "API调用"], btn: "当前方案", featured: false },
  { name: "Lite版", price: "¥9.9", unit: "/月", desc: "适合个人和小微商家", extra: "年付¥99（省17%）", features: ["每日300次AI对话", "全部工具使用", "1个知识库（20MB）", "全部行业模板"], disabled: ["自定义模板", "API调用"], btn: "升级到 Lite", featured: true },
  { name: "Pro版", price: "¥29", unit: "/月", desc: "适合专业用户", extra: "年付¥290（省17%）", features: ["不限次AI对话", "全部工具使用", "3个知识库（100MB）", "自定义模板", "数据分析报表"], disabled: ["API调用"], btn: "升级到 Pro", featured: false },
  { name: "VIP版", price: "¥99", unit: "/月", desc: "适合团队和企业", extra: "年付¥990（省17%）", features: ["不限次AI对话", "全部工具使用", "不限知识库", "自定义模板", "API调用", "团队协作（5人）", "专属客服"], disabled: [], btn: "联系我们", featured: false },
];

export default function PricingPage() {
  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, textAlign: "center" }}>定价方案</h1>
      <p style={{ color: "#8e8e93", fontSize: 15, marginBottom: 40, textAlign: "center" }}>先用好再付费，每个方案都可以随时取消</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        {plans.map((plan) => (
          <article key={plan.name} style={{ padding: 24, background: "#fff", border: plan.featured ? "2px solid #1a1a1a" : "1px solid #e5e5e7", borderRadius: 14, position: "relative" }}>
            {plan.featured ? <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", padding: "2px 12px", background: "#1a1a1a", color: "#fff", borderRadius: 6, fontSize: 12 }}>推荐</div> : null}
            <h2 style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{plan.name}</h2>
            <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>{plan.price}<span style={{ fontSize: 14, color: "#8e8e93" }}>{plan.unit}</span></div>
            <p style={{ color: "#8e8e93", fontSize: 14, marginBottom: 4 }}>{plan.desc}</p>
            {plan.extra ? <p style={{ fontSize: 12, color: "#8e8e93", marginBottom: 16 }}>{plan.extra}</p> : null}
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px", fontSize: 14, lineHeight: 2 }}>
              {plan.features.map((feature) => <li key={feature} style={{ color: "#1a1a1a" }}>✓ {feature}</li>)}
              {plan.disabled.map((feature) => <li key={feature} style={{ color: "#c7c7cc" }}>✗ {feature}</li>)}
            </ul>
            <button type="button" style={{ width: "100%", padding: "10px", border: "none", borderRadius: 10, background: plan.featured ? "#1a1a1a" : "#f0f0f2", color: plan.featured ? "#fff" : "#1a1a1a", fontWeight: 600, cursor: "pointer" }}>{plan.btn}</button>
          </article>
        ))}
      </div>
      <div style={{ textAlign: "center", marginTop: 40, fontSize: 13, color: "#8e8e93" }}>
        <p>所有方案包含：AI工具使用 · 行业知识库 · 数据加密</p>
        <p style={{ marginTop: 8 }}>支持微信支付 · 发票申请 · 7天无理由退款</p>
      </div>
    </div>
  );
}
