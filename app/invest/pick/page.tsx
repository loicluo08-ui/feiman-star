"use client";

import { FormEvent, useState } from "react";

type StockData = {
  quote: Record<string, number | string | null> | null;
  finance: Record<string, number | string | null> | null;
};

type AnalysisResult = { analysis: string };

export default function PickPage() {
  const [code, setCode] = useState("");
  const [market, setMarket] = useState("sh");
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [stockName, setStockName] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [error, setError] = useState("");

  async function fetchStock(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setLoadingData(true);
    setError("");
    setStockData(null);
    setAnalysis("");

    try {
      const res = await fetch(`/api/invest/stock?code=${c}&market=${market}`);
      if (!res.ok) throw new Error("行情获取失败");
      const json = await res.json();
      setStockData(json.data);
      const name = json.data?.quote?.f58 ?? c;
      setStockName(typeof name === "string" ? name : c);
    } catch {
      setError("行情数据暂时不可用，请检查代码和市场");
    } finally {
      setLoadingData(false);
    }
  }

  async function runAnalysis(e: FormEvent) {
    e.preventDefault();
    if (!stockData) return;
    setLoadingAI(true);
    setError("");
    setAnalysis("");

    try {
      const marketDataStr = JSON.stringify(stockData, null, 2);
      const res = await fetch("/api/invest/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockName: stockName || code,
          stockCode: code,
          marketData: marketDataStr,
          userNotes,
        }),
      });
      if (!res.ok) throw new Error("AI分析失败");
      const json = await res.json();
      setAnalysis(json.data?.analysis ?? "");
    } catch {
      setError("AI分析暂时不可用");
    } finally {
      setLoadingAI(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-10 sm:py-14">
      <h1 className="text-2xl font-semibold tracking-tight">AI选股助手</h1>
      <p className="mt-2 text-sm text-[#6e6e73]">输入A股代码，拉取实时行情+财务数据，AI出分析报告。</p>

      {/* 输入区 */}
      <form onSubmit={fetchStock} className="mt-6 flex flex-wrap gap-3">
        <select
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          className="rounded-xl border border-[#d1d1d6] px-3 py-2.5 text-sm outline-none focus:border-[#1a1a1a]"
        >
          <option value="sh">沪市</option>
          <option value="sz">深市</option>
          <option value="bj">北证</option>
        </select>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="股票代码，如 600519"
          maxLength={6}
          className="min-w-[180px] flex-1 rounded-xl border border-[#d1d1d6] px-4 py-2.5 text-sm outline-none focus:border-[#1a1a1a]"
        />
        <button
          type="submit"
          disabled={loadingData || !code.trim()}
          className="rounded-xl bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loadingData ? "拉取中…" : "拉取行情"}
        </button>
      </form>

      {/* 行情展示 */}
      {stockData?.quote ? (
        <div className="mt-6 rounded-2xl border border-[#e5e5e7] bg-white p-5">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{stockName}</h2>
            <span className="text-sm text-[#8e8e93]">{code}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="最新价" value={fmtNum(stockData.quote.f43)} />
            <Metric label="涨跌幅" value={fmtPct(stockData.quote.f170)} />
            <Metric label="成交额" value={fmtAmt(stockData.quote.f47)} />
            <Metric label="总市值" value={fmtAmt(stockData.quote.f116)} />
            <Metric label="PE(动)" value={fmtNum(stockData.quote.f162)} />
            <Metric label="PB" value={fmtNum(stockData.quote.f167)} />
            <Metric label="ROE" value={fmtPct(stockData.quote.f173)} />
            <Metric label="换手率" value={fmtPct(stockData.quote.f168)} />
          </div>
        </div>
      ) : null}

      {/* AI分析 */}
      {stockData?.quote ? (
        <form onSubmit={runAnalysis} className="mt-6">
          <textarea
            value={userNotes}
            onChange={(e) => setUserNotes(e.target.value)}
            placeholder="补充说明（可选）：如关注的指标、行业对比、特定问题等"
            rows={3}
            maxLength={2000}
            className="w-full resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none focus:border-[#1a1a1a]"
          />
          <button
            type="submit"
            disabled={loadingAI}
            className="mt-3 rounded-xl bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loadingAI ? "AI分析中…" : "开始AI分析"}
          </button>
        </form>
      ) : null}

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {analysis ? (
        <div className="mt-6 rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <h3 className="mb-3 text-base font-semibold">分析报告</h3>
          <div className="whitespace-pre-wrap text-sm leading-7 text-[#1a1a1a]">{analysis}</div>
        </div>
      ) : null}

      <p className="mt-8 text-xs text-[#8e8e93]">本工具仅供研究参考，不构成投资建议。</p>
    </div>
  );
}

function fmtNum(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

function fmtPct(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtAmt(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`;
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return n.toFixed(0);
}
