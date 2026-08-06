import Link from "next/link";

const toolCards = [
  { href: "/tools/edu-script", title: "教培客服话术", description: "生成稳健、积极、温和三种4段式成交话术。" },
  { href: "/tools/product-copy", title: "高转化商品文案", description: "生成三类详情页文案、SEO标题和评论引导。" },
];

export default function ToolsPage() {
  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>工具中心</h1>
      <p style={{ color: "#8e8e93", fontSize: 15, marginBottom: 32 }}>选择业务场景，填写真实资料后直接生成结果</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {toolCards.map((tool) => (
          <Link key={tool.href} href={tool.href} style={{ display: "block", padding: 24, border: "1px solid #e5e5e7", borderRadius: 14, background: "#fff" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>{tool.title}</h2>
            <p style={{ marginTop: 8, color: "#8e8e93", fontSize: 14, lineHeight: 1.6 }}>{tool.description}</p>
            <p style={{ marginTop: 20, fontSize: 14, fontWeight: 600 }}>立即使用 →</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
