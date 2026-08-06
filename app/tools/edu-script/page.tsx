"use client";

import { useState } from "react";

type ScriptVersion = {
  answer: string;
  value: string;
  objection: string;
  action: string;
};

type ScriptData = {
  stable: ScriptVersion;
  aggressive: ScriptVersion;
  gentle: ScriptVersion;
  bonus?: string;
};

const versions = [
  { key: "stable", label: "稳健型", description: "重事实，先建立信任" },
  { key: "aggressive", label: "积极型", description: "快节奏，推进明确行动" },
  { key: "gentle", label: "温和型", description: "重共情，降低决策压力" },
] as const;

const sections = [
  ["answer", "问题解答"],
  ["value", "价值传递"],
  ["objection", "异议处理"],
  ["action", "引导行动"],
] as const;

export default function EduScriptPage() {
  const [form, setForm] = useState({
    institutionName: "",
    courseType: "",
    parentQuestion: "",
    priceRange: "",
    institutionInfo: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScriptData | null>(null);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!form.institutionName.trim() || !form.courseType.trim() || !form.parentQuestion.trim()) {
      setError("请填写机构名称、课程类型和家长问题");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/tools/edu-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        data?: ScriptData;
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

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>教培客服话术</h1>
      <p style={{ color: "#8e8e93", fontSize: 14, marginBottom: 24 }}>根据家长原话生成稳健、积极、温和三种4段式成交话术</p>

      {error ? <div role="alert" style={{ padding: 12, background: "#fef2f2", color: "#dc2626", borderRadius: 10, marginBottom: 16, fontSize: 14 }}>{error}</div> : null}

      {!result ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>机构名称 *<input value={form.institutionName} onChange={(event) => setForm({ ...form, institutionName: event.target.value })} style={{ padding: "10px 14px", border: "1px solid #e5e5e7", borderRadius: 10, fontSize: 15 }} placeholder="例：星韵钢琴艺术中心" /></label>
            <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>课程类型 *<input value={form.courseType} onChange={(event) => setForm({ ...form, courseType: event.target.value })} style={{ padding: "10px 14px", border: "1px solid #e5e5e7", borderRadius: 10, fontSize: 15 }} placeholder="例：少儿钢琴" /></label>
          </div>
          <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>家长问题 *<textarea value={form.parentQuestion} onChange={(event) => setForm({ ...form, parentQuestion: event.target.value })} rows={4} style={{ padding: "10px 14px", border: "1px solid #e5e5e7", borderRadius: 10, fontSize: 15, resize: "vertical" }} placeholder="例：你们钢琴课多少钱？孩子5岁零基础" /></label>
          <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>价格区间（选填）<input value={form.priceRange} onChange={(event) => setForm({ ...form, priceRange: event.target.value })} style={{ padding: "10px 14px", border: "1px solid #e5e5e7", borderRadius: 10, fontSize: 15 }} placeholder="例：120-180元/课时" /></label>
          <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>机构信息（选填）<textarea value={form.institutionInfo} onChange={(event) => setForm({ ...form, institutionInfo: event.target.value })} rows={5} style={{ padding: "10px 14px", border: "1px solid #e5e5e7", borderRadius: 10, fontSize: 15, resize: "vertical" }} placeholder="师资、班型、课程特色、试听政策等真实信息" /></label>
          <button type="button" onClick={handleSubmit} disabled={loading} style={{ padding: "14px 24px", background: loading ? "#c7c7cc" : "#1a1a1a", color: "#fff", border: 0, borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>{loading ? "生成中…" : "生成三版话术"}</button>
        </div>
      ) : (
        <div aria-live="polite">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>三种策略结果</h2>
            <button type="button" onClick={() => setResult(null)} style={{ padding: "8px 16px", border: "1px solid #e5e5e7", borderRadius: 8, background: "#fff", cursor: "pointer" }}>重新生成</button>
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            {versions.map((version) => (
              <article key={version.key} style={{ border: "1px solid #e5e5e7", borderRadius: 14, padding: 20 }}>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>{version.label}</h3>
                <p style={{ color: "#8e8e93", fontSize: 12, marginTop: 4, marginBottom: 16 }}>{version.description}</p>
                <div style={{ display: "grid", gap: 14 }}>
                  {sections.map(([key, label]) => (
                    <section key={key}>
                      <h4 style={{ color: "#8e8e93", fontSize: 12, fontWeight: 600 }}>{label}</h4>
                      <p style={{ marginTop: 4, fontSize: 14, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{result[version.key][key]}</p>
                    </section>
                  ))}
                </div>
              </article>
            ))}
            {result.bonus ? <aside style={{ background: "#f7f7f8", borderRadius: 14, padding: 18, fontSize: 14 }}><strong>沟通技巧：</strong> {result.bonus}</aside> : null}
          </div>
        </div>
      )}
    </div>
  );
}
