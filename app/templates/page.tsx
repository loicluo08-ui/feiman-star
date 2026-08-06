const templates = [
  { name: "教培招生话术模板", desc: "暑期班/秋季班招生标准话术，含异议处理", tags: ["教培", "话术"] },
  { name: "电商详情页模板", desc: "淘宝/拼多多商品详情页文案结构模板", tags: ["电商", "文案"] },
  { name: "小红书种草模板", desc: "产品种草笔记结构，含标题公式和正文框架", tags: ["小红书", "内容"] },
  { name: "社群欢迎语模板", desc: "新成员进群欢迎+引导互动话术", tags: ["社群", "话术"] },
  { name: "客服FAQ模板", desc: "常见问题标准回答格式，支持多行业", tags: ["客服", "FAQ"] },
  { name: "促销活动文案模板", desc: "限时折扣/满减/赠品活动文案结构", tags: ["电商", "促销"] },
];

export default function TemplatesPage() {
  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>模板库</h1>
      <p style={{ color: "#8e8e93", fontSize: 15, marginBottom: 32 }}>行业模板一键套用，降低使用门槛</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {templates.map((template) => (
          <article key={template.name} style={{ padding: 20, background: "#fff", border: "1px solid #e5e5e7", borderRadius: 14 }}>
            <h2 style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>{template.name}</h2>
            <p style={{ color: "#8e8e93", fontSize: 14, marginBottom: 12 }}>{template.desc}</p>
            <div style={{ display: "flex", gap: 6 }}>{template.tags.map((tag) => <span key={tag} style={{ padding: "2px 8px", background: "#f0f0f2", borderRadius: 4, fontSize: 12 }}>{tag}</span>)}</div>
          </article>
        ))}
      </div>
    </div>
  );
}
