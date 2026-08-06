const knowledgeBases = [
  { name: "教培行业知识库", desc: "课程体系、家长常见问题、退费政策、成交流程", size: "2.4MB", docs: 48 },
  { name: "电商客服知识库", desc: "尺码/物流/退换货/售后标准话术", size: "1.8MB", docs: 36 },
  { name: "本地服务知识库", desc: "预约/价格/地址/营业时间标准回复", size: "1.2MB", docs: 24 },
  { name: "医美咨询知识库", desc: "项目介绍/价格/注意事项/合规话术", size: "3.1MB", docs: 52 },
];

export default function KnowledgePage() {
  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>知识库</h1>
      <p style={{ color: "#8e8e93", fontSize: 15, marginBottom: 32 }}>上传你的业务资料，AI基于资料回答问题</p>
      <div style={{ padding: 32, border: "2px dashed #e5e5e7", borderRadius: 14, textAlign: "center", marginBottom: 24 }}>
        <p style={{ fontSize: 14, color: "#8e8e93" }}>拖拽文件到此处或点击上传（支持 PDF / Word / TXT / Markdown）</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {knowledgeBases.map((knowledgeBase) => (
          <article key={knowledgeBase.name} style={{ padding: 20, background: "#fff", border: "1px solid #e5e5e7", borderRadius: 14 }}>
            <h2 style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>{knowledgeBase.name}</h2>
            <p style={{ color: "#8e8e93", fontSize: 14, marginBottom: 12 }}>{knowledgeBase.desc}</p>
            <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#8e8e93" }}><span>{knowledgeBase.docs} 篇文档</span><span>{knowledgeBase.size}</span></div>
          </article>
        ))}
      </div>
      <div style={{ marginTop: 24, padding: 16, background: "#eff6ff", borderRadius: 10, fontSize: 14, color: "#2563eb" }}>提示：知识库功能需要 Lite 版及以上套餐。当前为免费体验，可使用预置行业知识库。</div>
    </div>
  );
}
