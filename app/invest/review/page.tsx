"use client";

import { FormEvent, useState } from "react";

export default function ReviewPage() {
  const [trades, setTrades] = useState("");
  const [strategy, setStrategy] = useState("");
  const [questions, setQuestions] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trades.trim() || loading) return;
    setLoading(true);
    setError("");
    setAnalysis("");

    try {
      const res = await fetch("/api/invest/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trades, strategy, questions }),
      });
      if (!res.ok) throw new Error("分析失败");
      const json = await res.json();
      setAnalysis(json.data?.analysis ?? "");
    } catch {
      setError("AI分析暂时不可用");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-10 sm:py-14">
      <h1 className="text-2xl font-semibold tracking-tight">交易复盘</h1>
      <p className="mt-2 text-sm text-[#6e6e73]">粘贴交易记录，AI做归因分析——盈亏来源、行为偏差、改进建议。</p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="text-sm font-medium">交易记录 *</label>
          <p className="mt-1 text-xs text-[#8e8e93]">
            格式示例：2026-07-15 买入 贵州茅台 600519 1手 1685.00 / 2026-08-01 卖出 1手 1710.00
          </p>
          <textarea
            value={trades}
            onChange={(e) => setTrades(e.target.value)}
            rows={8}
            maxLength={8000}
            placeholder="粘贴你的交易记录…"
            className="mt-2 w-full resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none focus:border-[#1a1a1a]"
          />
        </div>

        <div>
          <label className="text-sm font-medium">使用的策略（可选）</label>
          <textarea
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="描述你的交易策略/逻辑，方便AI评估策略有效性"
            className="mt-2 w-full resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none focus:border-[#1a1a1a]"
          />
        </div>

        <div>
          <label className="text-sm font-medium">特别想分析的问题（可选）</label>
          <textarea
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="如：为什么7月连续亏损？我的止损策略有效吗？"
            className="mt-2 w-full resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none focus:border-[#1a1a1a]"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !trades.trim()}
          className="rounded-xl bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "AI分析中…" : "开始复盘分析"}
        </button>
      </form>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {analysis ? (
        <div className="mt-6 rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <h3 className="mb-3 text-base font-semibold">复盘报告</h3>
          <div className="whitespace-pre-wrap text-sm leading-7 text-[#1a1a1a]">{analysis}</div>
        </div>
      ) : null}

      <p className="mt-8 text-xs text-[#8e8e93]">本工具仅供研究参考，不构成投资建议。</p>
    </div>
  );
}
