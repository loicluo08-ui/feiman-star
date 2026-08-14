"use client";

import { FormEvent, useState } from "react";

type Financials = {
  pe: number | null;
  forwardPe: number | null;
  pb: number | null;
  ps: number | null;
  evToEbitda: number | null;
  dividendYield: number | null;
  payoutRatio: number | null;
  beta: number | null;
  roe: number | null;
  roa: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  profitMargin: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  freeCashflow: number | null;
  operatingCashflow: number | null;
  eps: number | null;
  forwardEps: number | null;
  pegRatio: number | null;
  enterpriseValue: number | null;
  profitMargins: number | null;
  sector: string | null;
  industry: string | null;
  fullTimeEmployees: number | null;
  longBusinessSummary: string | null;
};

type Candle = { date: string; close: number | null; volume: number | null };

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
  candles: Candle[];
  financials: Financials | null;
};

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
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "获取失败");
      }
      const json = await res.json();
      setStockData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取行情失败");
    } finally {
      setLoadingData(false);
    }
  }

  async function runAnalysis() {
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
          stockName: stockData.name,
          stockCode: stockData.code,
          marketData: marketDataStr,
          userNotes,
        }),
      });
      if (!res.ok) throw new Error("分析失败");
      const json = await res.json();
      setAnalysis(json.data?.analysis ?? "");
    } catch {
      setError("AI分析暂时不可用");
    } finally {
      setLoadingAI(false);
    }
  }

  const pricePosition = stockData?.fiftyTwoWeekHigh && stockData?.fiftyTwoWeekLow && stockData?.price
    ? ((stockData.price - stockData.fiftyTwoWeekLow) / (stockData.fiftyTwoWeekHigh - stockData.fiftyTwoWeekLow)) * 100
    : null;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI选股助手</h1>
        <p className="mt-2 text-sm text-[#6e6e73]">输入美股代码，拉取实时行情+财务数据，AI生成分析报告</p>
      </header>

      {/* 搜索框 */}
      <form onSubmit={fetchStock} className="flex gap-2.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="美股代码，如 AAPL / TSLA / NVDA"
          className="min-w-0 flex-1 rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm uppercase outline-none transition-colors focus:border-[#1a1a1a]"
          maxLength={6}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={loadingData || !code.trim()}
          className="shrink-0 rounded-xl bg-[#1a1a1a] px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loadingData ? "拉取中…" : "拉取行情"}
        </button>
      </form>

      {/* 快捷代码 */}
      <div className="mt-3 flex flex-wrap gap-2">
        {["AAPL", "TSLA", "NVDA", "GOOGL", "MSFT", "AMZN", "META"].map((t) => (
          <button
            key={t}
            onClick={() => {
              setCode(t);
              setTimeout(() => fetchStock({ preventDefault: () => {} } as FormEvent), 0);
            }}
            className="rounded-md bg-[#f2f2f3] px-2.5 py-1 text-xs font-medium text-[#6e6e73] transition-colors hover:bg-[#e5e5e7]"
          >
            {t}
          </button>
        ))}
      </div>

      {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p> : null}

      {/* 骨架屏 */}
      {loadingData && !stockData ? (
        <div className="mt-8 animate-pulse space-y-4">
          <div className="h-32 rounded-2xl bg-[#f2f2f3]" />
          <div className="h-48 rounded-2xl bg-[#f2f2f3]" />
        </div>
      ) : null}

      {/* 行情展示 */}
      {stockData ? (
        <div className="mt-8 space-y-4">
          {/* 价格卡片 */}
          <div className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-xl font-semibold">{stockData.name}</h2>
                  <span className="text-sm text-[#8e8e93]">{stockData.code}</span>
                </div>
                <p className="mt-0.5 text-xs text-[#8e8e93]">
                  {stockData.exchange} · {stockData.currency}
                  {stockData.financials?.sector ? ` · ${stockData.financials.sector}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums">
                  {stockData.price != null ? `$${stockData.price.toFixed(2)}` : "—"}
                </p>
                <p
                  className={`mt-0.5 text-sm font-medium tabular-nums ${
                    stockData.change != null && stockData.change >= 0 ? "text-[#16a34a]" : "text-[#dc2626]"
                  }`}
                >
                  {stockData.change != null
                    ? `${stockData.change >= 0 ? "+" : ""}${stockData.change.toFixed(2)} (${stockData.changePct?.toFixed(2) ?? "—"}%)`
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* K线迷你图 */}
          {stockData.candles.length > 0 ? (
            <MiniChart candles={stockData.candles} high52={stockData.fiftyTwoWeekHigh} low52={stockData.fiftyTwoWeekLow} />
          ) : null}

          {/* 52周价格位置 */}
          {pricePosition != null ? (
            <div className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
              <div className="flex items-center justify-between text-xs text-[#8e8e93]">
                <span>52周低 ${stockData.fiftyTwoWeekLow?.toFixed(2)}</span>
                <span className="font-medium text-[#1a1a1a]">当前位置 {pricePosition.toFixed(0)}%</span>
                <span>52周高 ${stockData.fiftyTwoWeekHigh?.toFixed(2)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#f2f2f3]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#dc2626] via-[#d97706] to-[#16a34a]"
                  style={{ width: `${Math.min(100, Math.max(0, pricePosition))}%` }}
                />
              </div>
            </div>
          ) : null}

          {/* 指标网格 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <MetricCard label="市值" value={fmtAmt(stockData.marketCap)} />
            <MetricCard label="成交量" value={fmtVol(stockData.volume)} />
            <MetricCard label="P/E (TTM)" value={fmtNum(stockData.financials?.pe)} />
            <MetricCard label="P/E (Forward)" value={fmtNum(stockData.financials?.forwardPe)} />
            <MetricCard label="P/B" value={fmtNum(stockData.financials?.pb)} />
            <MetricCard label="P/S" value={fmtNum(stockData.financials?.ps)} />
            <MetricCard label="EV/EBITDA" value={fmtNum(stockData.financials?.evToEbitda)} />
            <MetricCard label="PEG Ratio" value={fmtNum(stockData.financials?.pegRatio)} />
            <MetricCard label="ROE" value={fmtPct(stockData.financials?.roe)} />
            <MetricCard label="ROA" value={fmtPct(stockData.financials?.roa)} />
            <MetricCard label="毛利率" value={fmtPct(stockData.financials?.grossMargin)} />
            <MetricCard label="营业利润率" value={fmtPct(stockData.financials?.operatingMargin)} />
            <MetricCard label="净利润率" value={fmtPct(stockData.financials?.profitMargin)} />
            <MetricCard label="营收增速" value={fmtPct(stockData.financials?.revenueGrowth)} />
            <MetricCard label="利润增速" value={fmtPct(stockData.financials?.earningsGrowth)} />
            <MetricCard label="负债/权益" value={fmtNum(stockData.financials?.debtToEquity)} />
            <MetricCard label="流动比率" value={fmtNum(stockData.financials?.currentRatio)} />
            <MetricCard label="速动比率" value={fmtNum(stockData.financials?.quickRatio)} />
            <MetricCard label="EPS (TTM)" value={fmtNum(stockData.financials?.eps)} />
            <MetricCard label="EPS (Forward)" value={fmtNum(stockData.financials?.forwardEps)} />
            <MetricCard label="股息率" value={fmtPct(stockData.financials?.dividendYield)} />
            <MetricCard label="派息率" value={fmtPct(stockData.financials?.payoutRatio)} />
            <MetricCard label="Beta" value={fmtNum(stockData.financials?.beta)} />
            <MetricCard label="自由现金流" value={fmtAmt(stockData.financials?.freeCashflow)} />
          </div>

          {/* 公司简介 */}
          {stockData.financials?.longBusinessSummary ? (
            <div className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
              <h3 className="mb-2 text-sm font-semibold text-[#8e8e93]">公司简介</h3>
              <p className="text-sm leading-7 text-[#1a1a1a]">{stockData.financials.longBusinessSummary}</p>
            </div>
          ) : null}

          {/* AI分析 */}
          <div className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
            <h3 className="mb-3 text-base font-semibold">AI选股分析</h3>
            <textarea
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="补充说明（可选）：如关注的指标、对比公司、特殊问题等"
              className="mb-3 w-full resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none focus:border-[#1a1a1a]"
            />
            <button
              onClick={runAnalysis}
              disabled={loadingAI}
              className="rounded-xl bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {loadingAI ? "AI分析中…" : analysis ? "重新分析" : "开始AI分析"}
            </button>

            {loadingAI ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-[#8e8e93]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#e5e5e7] border-t-[#1a1a1a]" />
                正在生成分析报告，约15-30秒…
              </div>
            ) : null}

            {analysis ? (
              <div className="mt-4 rounded-xl bg-[#f7f7f8] p-4">
                <div className="whitespace-pre-wrap text-sm leading-7 text-[#1a1a1a]">{analysis}</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="mt-10 text-xs text-[#8e8e93]">
        行情数据来自 Yahoo Finance，可能存在 15 分钟延迟。本工具仅供研究参考，不构成投资建议。
      </p>
    </div>
  );
}

/* === 组件 === */

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#e5e5e7] bg-white px-4 py-3">
      <p className="text-xs text-[#8e8e93]">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function MiniChart({ candles, high52, low52 }: { candles: Candle[]; high52: number | null; low52: number | null }) {
  const valid = candles.filter((c) => c.close != null) as Array<{ date: string; close: number }>;
  if (valid.length < 2) return null;

  const prices = valid.map((c) => c.close);
  const min = Math.min(...prices, low52 ?? Infinity);
  const max = Math.max(...prices, high52 ?? -Infinity);
  const range = max - min || 1;
  const W = 800;
  const H = 180;
  const padding = { top: 20, right: 40, bottom: 30, left: 50 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;

  const points = valid.map((c, i) => {
    const x = padding.left + (i / (valid.length - 1)) * chartW;
    const y = padding.top + chartH - ((c.close - min) / range) * chartH;
    return { x, y, close: c.close, date: c.date };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  // Y轴标签 (5档)
  const yLabels = Array.from({ length: 5 }, (_, i) => {
    const val = max - (range * i) / 4;
    const y = padding.top + (chartH * i) / 4;
    return { val, y };
  });

  const firstPrice = valid[0].close;
  const lastPrice = valid[valid.length - 1].close;
  const isUp = lastPrice >= firstPrice;
  const lineColor = isUp ? "#16a34a" : "#dc2626";

  return (
    <div className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#8e8e93]">30日走势</h3>
        <span className={`text-xs font-medium ${isUp ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
          {isUp ? "▲" : "▼"} {(((lastPrice - firstPrice) / firstPrice) * 100).toFixed(2)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
        {/* Y轴标签 */}
        {yLabels.map((yl, i) => (
          <g key={i}>
            <line x1={padding.left} y1={yl.y} x2={W - padding.right} y2={yl.y} stroke="#f2f2f3" strokeWidth="1" />
            <text x={padding.left - 8} y={yl.y + 3} textAnchor="end" fontSize="10" fill="#8e8e93">
              ${yl.val.toFixed(2)}
            </text>
          </g>
        ))}
        {/* 价格线 */}
        <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* 起点终点 */}
        <circle cx={points[0].x} cy={points[0].y} r="3" fill={lineColor} />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={lineColor} />
        {/* 最后价格标签 */}
        <text x={W - padding.right + 4} y={points[points.length - 1].y + 3} fontSize="10" fill={lineColor} fontWeight="600">
          ${lastPrice.toFixed(2)}
        </text>
        {/* X轴日期 */}
        <text x={padding.left} y={H - 8} fontSize="10" fill="#8e8e93">
          {valid[0].date.slice(5)}
        </text>
        <text x={W - padding.right} y={H - 8} fontSize="10" fill="#8e8e93" textAnchor="end">
          {valid[valid.length - 1].date.slice(5)}
        </text>
      </svg>
    </div>
  );
}

/* === 格式化 === */

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
  // Yahoo Finance的比率类指标返回小数（0.15 = 15%）
  const pct = n > 1 ? n : n * 100;
  return `${pct.toFixed(2)}%`;
}

function fmtAmt(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtVol(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}
