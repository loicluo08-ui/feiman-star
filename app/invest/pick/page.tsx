"use client";

import { FormEvent, useState } from "react";

type StockData = {
  code: string;
  name: string;
  currency: string;
  exchange: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  candles: Array<{ date: string; close: number | null; volume: number | null }>;
};

type AnalysisResult = { analysis: string };

export default function PickPage() {
  const [code, setCode] = useState("");
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [userNotes, setUserNotes] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [error, setError] = useState("");

  async function fetchStock(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setLoadingData(true);
    setError("");
    setStockData(null);
    setAnalysis("");

    try {
      const res = await fetch(`/api/invest/stock?code=${encodeURIComponent(c)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "行情获取失败");
      }
      const json = await res.json();
      setStockData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoadingData(false);
    }
  }

  async function analyze() {
    if (!stockData) return;
    setLoadingAI(true);
    setError("");
    setAnalysis("");

    try {
      const marketData = JSON.stringify(stockData, null, 2);
      const res = await fetch("/api/invest/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockName: stockData.name,
          stockCode: stockData.code,
          marketData,
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
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight">AI选股助手</h1>
      <p className="mt-2 text-sm text-[#6e6e73]">输入美股代码，拉取实时行情，AI出分析报告。</p>

      <form onSubmit={fetchStock} className="mt-8 flex gap-2.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="如 AAPL, TSLA, NVDA"
          maxLength={6}
          className="flex-1 rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm uppercase outline-none focus:border-[#1a1a1a]"
        />
        <button
          type="submit"
          disabled={loadingData || !code.trim()}
          className="rounded-xl bg-[#1a1a1a] px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loadingData ? "拉取中…" : "拉取行情"}
        </button>
      </form>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {stockData ? (
        <div className="mt-8 rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-semibold">{stockData.name}</h2>
              <p className="text-xs text-[#8e8e93]">{stockData.code} · {stockData.exchange}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold tabular-nums">
                {fmtPrice(stockData.price)}
                <span className="ml-1 text-sm text-[#8e8e93]">{stockData.currency}</span>
              </p>
              <p className={`text-sm tabular-nums ${stockData.change != null && stockData.change >= 0 ? "text-green-600" : "text-red-600"}`}>
                {stockData.change != null ? `${stockData.change >= 0 ? "+" : ""}${fmtNum(stockData.change)}` : "—"}
                {stockData.changePct != null ? ` (${stockData.changePct >= 0 ? "+" : ""}${fmtPct(stockData.changePct)})` : ""}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="市值" value={fmtAmt(stockData.marketCap)} />
            <Metric label="52周高" value={fmtPrice(stockData.fiftyTwoWeekHigh)} />
            <Metric label="52周低" value={fmtPrice(stockData.fiftyTwoWeekLow)} />
            <Metric label="成交量" value={fmtAmt(stockData.volume)} />
          </div>

          {stockData.candles.length > 1 ? (
            <div className="mt-5">
              <p className="mb-2 text-xs font-medium text-[#8e8e93]">近5日收盘</p>
              <div className="flex gap-2">
                {stockData.candles.map((c) => (
                  <div key={c.date} className="rounded-lg bg-[#f7f7f8] px-3 py-2 text-center">
                    <p className="text-xs text-[#8e8e93]">{c.date.slice(5)}</p>
                    <p className="text-sm font-medium tabular-nums">{fmtPrice(c.close)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-6">
            <label className="text-sm font-medium text-[#6e6e73]">补充说明（可选）</label>
            <textarea
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="如：关注AI芯片业务增速，想了解估值是否合理"
              className="mt-2 w-full resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none focus:border-[#1a1a1a]"
            />
          </div>

          <button
            onClick={analyze}
            disabled={loadingAI}
            className="mt-4 rounded-xl bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loadingAI ? "AI分析中…" : "AI分析"}
          </button>
        </div>
      ) : null}

      {analysis ? (
        <div className="mt-6 rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <h3 className="mb-3 text-base font-semibold">分析报告</h3>
          <div className="whitespace-pre-wrap text-sm leading-7 text-[#1a1a1a]">{analysis}</div>
        </div>
      ) : null}

      <p className="mt-8 text-xs text-[#8e8e93]">数据来自Yahoo Finance。仅供研究参考，不构成投资建议。</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f7f7f8] px-3 py-2.5">
      <p className="text-xs text-[#8e8e93]">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function fmtPrice(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

function fmtNum(v: unknown): string {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

function fmtPct(v: unknown): string {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtAmt(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}
