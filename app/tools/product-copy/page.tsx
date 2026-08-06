"use client";

import { useState } from "react";

type CopyVersion = {
  title: string;
  subtitle: string;
  detail: string;
  points: string[];
};

type CopyData = {
  functional: CopyVersion;
  scenario: CopyVersion;
  comparison: CopyVersion;
  seo_titles: string[];
  review_guide: string;
};

const versions = [
  { key: "functional", label: "功能导向型", desc: "突出产品功能参数" },
  { key: "scenario", label: "场景代入型", desc: "用使用场景打动用户" },
  { key: "comparison", label: "对比种草型", desc: "通过对比突出优势" },
] as const;

type VersionKey = (typeof versions)[number]["key"];

const platforms = ["淘宝", "京东", "拼多多", "抖音", "小红书", "微信"];

export default function ProductCopyPage() {
  const [form, setForm] = useState({
    productName: "",
    productInfo: "",
    targetAudience: "",
    platform: "淘宝",
    priceRange: "",
    knowledgeBase: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CopyData | null>(null);
  const [error, setError] = useState("");
  const [activeVersion, setActiveVersion] = useState<VersionKey>("functional");

  async function handleSubmit() {
    if (!form.productName.trim() || !form.productInfo.trim() || !form.targetAudience.trim()) {
      setError("请填写商品名称、商品信息和目标受众");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/tools/product-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        data?: CopyData;
        error?: string;
      };
      if (!response.ok || !payload.success || !payload.data) {
        setError(payload.error || "生成失败");
        return;
      }
      setResult(payload.data);
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("复制失败，请手动选择文本");
    }
  }

  if (result) {
    const version = result[activeVersion];
    return (
      <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>生成结果</h1>
            <p style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>{versions.find((item) => item.key === activeVersion)?.desc}</p>
          </div>
          <button type="button" onClick={() => setResult(null)} style={{ padding: "8px 16px", border: "1px solid #e5e5e7", borderRadius: 8, background: "#fff", cursor: "pointer" }}>重新生成</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          {versions.map((item) => (
            <button
              type="button"
              key={item.key}
              onClick={() => setActiveVersion(item.key)}
              aria-pressed={activeVersion === item.key}
              style={{ padding: "10px 16px", borderRadius: 10, border: activeVersion === item.key ? "2px solid #1a1a1a" : "1px solid #e5e5e7", background: activeVersion === item.key ? "#1a1a1a" : "#fff", color: activeVersion === item.key ? "#fff" : "#1a1a1a", cursor: "pointer", fontSize: 14 }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <article style={{ background: "#f7f7f8", borderRadius: 14, padding: 24, marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{version.title}</h2>
          <p style={{ fontSize: 14, color: "#8e8e93", marginBottom: 16 }}>{version.subtitle}</p>
          <p style={{ fontSize: 15, lineHeight: 1.8, marginBottom: 16, whiteSpace: "pre-wrap" }}>{version.detail}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {version.points?.map((point) => (
              <span key={point} style={{ padding: "4px 12px", background: "#fff", borderRadius: 6, fontSize: 13, border: "1px solid #e5e5e7" }}>{point}</span>
            ))}
          </div>
          <button type="button" onClick={() => copyText(`${version.title}\n${version.subtitle}\n${version.detail}`)} style={{ marginTop: 16, padding: "8px 16px", border: "1px solid #e5e5e7", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13 }}>复制全部</button>
        </article>

        {result.seo_titles?.length > 0 ? (
          <section style={{ background: "#eff6ff", borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <h2 style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>附赠：SEO搜索标题</h2>
            {result.seo_titles.map((title) => (
              <button type="button" key={title} onClick={() => copyText(title)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "#fff", border: 0, borderRadius: 6, marginBottom: 4, cursor: "pointer", fontSize: 14 }}>
                {title} <span style={{ color: "#8e8e93", fontSize: 12 }}>（点击复制）</span>
              </button>
            ))}
          </section>
        ) : null}

        {result.review_guide ? (
          <section style={{ background: "#f0fdf4", borderRadius: 14, padding: 16, fontSize: 14 }}>
            <strong>评论引导话术：</strong> {result.review_guide}
          </section>
        ) : null}
        {error ? <p role="alert" style={{ color: "#dc2626", marginTop: 16 }}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>高转化商品文案</h1>
      <p style={{ color: "#8e8e93", fontSize: 14, marginBottom: 24 }}>生成3个版本的商品详情页文案 + SEO标题 + 评论引导话术</p>
      {error ? <div role="alert" style={{ padding: 12, background: "#fef2f2", color: "#dc2626", borderRadius: 10, marginBottom: 16, fontSize: 14 }}>{error}</div> : null}
      <div style={{ display: "grid", gap: 16 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>商品名称 *<input value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} style={{ width: "100%", padding: "10px 14px", border: "1px solid #e5e5e7", borderRadius: 10, fontSize: 15 }} placeholder="例：纯棉短袖T恤" /></label>
        <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>商品信息 *<textarea value={form.productInfo} onChange={(event) => setForm({ ...form, productInfo: event.target.value })} rows={5} style={{ width: "100%", padding: "10px 14px", border: "1px solid #e5e5e7", borderRadius: 10, fontSize: 15, resize: "vertical" }} placeholder="材质、尺码、颜色、功能特点等" /></label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>目标受众 *<input value={form.targetAudience} onChange={(event) => setForm({ ...form, targetAudience: event.target.value })} style={{ width: "100%", padding: "10px 14px", border: "1px solid #e5e5e7", borderRadius: 10, fontSize: 15 }} placeholder="例：25-35岁女性" /></label>
          <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>投放平台<select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })} style={{ width: "100%", padding: "10px 14px", border: "1px solid #e5e5e7", borderRadius: 10, fontSize: 15 }}>{platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select></label>
        </div>
        <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>价格区间（选填）<input value={form.priceRange} onChange={(event) => setForm({ ...form, priceRange: event.target.value })} style={{ width: "100%", padding: "10px 14px", border: "1px solid #e5e5e7", borderRadius: 10, fontSize: 15 }} placeholder="例：59-129元" /></label>
        <button type="button" onClick={handleSubmit} disabled={loading} style={{ padding: "14px 24px", background: loading ? "#c7c7cc" : "#1a1a1a", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>{loading ? "生成中…" : "生成文案"}</button>
      </div>
    </div>
  );
}
