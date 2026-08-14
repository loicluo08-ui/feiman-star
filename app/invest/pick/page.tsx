"use client";

import { useEffect, useRef, useState } from "react";
import { setGlobalLoading } from "@/components/app-shell";
import { toPng } from "html-to-image";

type SearchResult = {
  code: string;
  name: string;
  exchange: string | null;
  type: string;
};

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
  isETF?: boolean;
};

export default function PickPage() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [userNotes, setUserNotes] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [loadingStep, setLoadingStep] = useState("正在拉取数据…");
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [error, setError] = useState("");
  const [copyLabel, setCopyLabel] = useState("复制");
  const [exporting, setExporting] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // 搜索联想（防抖300ms）
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }

    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    setLoadingSuggest(true);

    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/invest/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const json = await res.json();
          setSuggestions(json.data ?? []);
          setShowSuggest(true);
          setHighlightIdx(-1);
        }
      } catch {
        // ignore
      } finally {
        setLoadingSuggest(false);
      }
    }, 300);

    return () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
  }, [query]);

  async function fetchStock(code: string) {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setLoadingData(true);
    setError("");
    setStockData(null);
    setAnalysis("");
    setShowSuggest(false);

    try {
      const res = await fetch(`/api/invest/stock?code=${encodeURIComponent(c)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "获取失败");
      }
      const json = await res.json();
      setStockData(json.data);
      setQuery(json.data.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取行情失败");
    } finally {
      setLoadingData(false);
    }
  }

  function handleSuggestionClick(s: SearchResult) {
    setQuery(s.code);
    setShowSuggest(false);
    fetchStock(s.code);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggest || suggestions.length === 0) {
      if (e.key === "Enter") {
        e.preventDefault();
        // 如果输入的是有效代码格式，直接拉取
        if (/^[A-Z]{1,6}$/.test(query.trim().toUpperCase())) {
          fetchStock(query.trim().toUpperCase());
        }
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
        handleSuggestionClick(suggestions[highlightIdx]);
      } else if (/^[A-Z]{1,6}$/.test(query.trim().toUpperCase())) {
        fetchStock(query.trim().toUpperCase());
      }
    } else if (e.key === "Escape") {
      setShowSuggest(false);
    }
  }

  async function runAnalysis() {
    if (!stockData) return;
    setLoadingAI(true);
    setGlobalLoading(true, "AI分析进行中…");
    setError("");
    setAnalysis("");

    try {
      const marketDataStr = JSON.stringify(stockData, null, 2);

      // 并行拉取新闻+市场快报
      setLoadingStep("正在拉取新闻和市场快报…");
      const [newsRes, pulseRes] = await Promise.all([
        fetch(`/api/invest/news?code=${encodeURIComponent(stockData.code)}`).catch(() => null),
        fetch("/api/invest/market-pulse").catch(() => null),
      ]);
      const newsData = newsRes?.ok ? await newsRes.json() : null;
      const pulseData = pulseRes?.ok ? await pulseRes.json() : null;

      setLoadingStep("AI正在生成深度分析报告，约15-30秒…");
      const res = await fetch("/api/invest/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockName: stockData.name,
          stockCode: stockData.code,
          marketData: marketDataStr,
          news: newsData?.data?.news ?? [],
          nextEarnings: newsData?.data?.nextEarnings ?? null,
          marketPulse: pulseData?.data ?? null,
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
      setGlobalLoading(false);
    }
  }

  async function copyAnalysis() {
    if (!analysis) return;
    try {
      await navigator.clipboard.writeText(analysis);
      setCopyLabel("已复制");
      window.setTimeout(() => setCopyLabel("复制"), 1600);
    } catch {
      setError("复制失败，请手动选择报告内容复制");
    }
  }

  async function exportAnalysisImage() {
    if (!analysis || !stockData || !reportRef.current || exporting) return;
    setExporting(true);
    setError("");

    try {
      const dataUrl = await toPng(reportRef.current, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        pixelRatio: 2,
      });
      const now = new Date();
      const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      const link = document.createElement("a");
      link.download = `费曼星分析_${stockData.code}_${date}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setError("图片导出失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  }

  const pricePosition = stockData?.fiftyTwoWeekHigh && stockData?.fiftyTwoWeekLow && stockData?.price
    ? ((stockData.price - stockData.fiftyTwoWeekLow) / (stockData.fiftyTwoWeekHigh - stockData.fiftyTwoWeekLow)) * 100
    : null;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI选股助手</h1>
        <p className="mt-2 text-sm text-[#6e6e73]">输入美股代码或公司名称，拉取行情+财务数据，AI生成分析报告</p>
      </header>

      {/* 搜索框 */}
      <div className="relative">
        <div className="flex gap-2.5">
          <div className="relative min-w-0 flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (suggestions.length > 0) setShowSuggest(true); }}
              onBlur={() => { blurTimer.current = setTimeout(() => setShowSuggest(false), 150); }}
              placeholder="代码或公司名，如 AAPL / 苹果 / Apple / Tesla"
              className="w-full rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none transition-colors focus:border-[#1a1a1a]"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
            />
            {loadingSuggest ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#e5e5e7] border-t-[#8e8e93]" />
              </span>
            ) : null}
          </div>
          <button
            onClick={() => {
              const c = query.trim().toUpperCase();
              if (/^[A-Z]{1,6}$/.test(c)) fetchStock(c);
            }}
            disabled={loadingData || !query.trim()}
            className="shrink-0 rounded-xl bg-[#1a1a1a] px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loadingData ? "拉取中…" : "拉取行情"}
          </button>
        </div>

        {/* 联想下拉 */}
        {showSuggest && suggestions.length > 0 ? (
          <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-[#e5e5e7] bg-white py-1 shadow-lg">
            {suggestions.map((s, i) => (
              <li key={s.code}>
                <button
                  onMouseDown={(e) => { e.preventDefault(); handleSuggestionClick(s); }}
                  onMouseEnter={() => setHighlightIdx(i)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === highlightIdx ? "bg-[#f7f7f8]" : "bg-white"
                  }`}
                >
                  <span className="shrink-0 rounded-md bg-[#f2f2f3] px-2 py-0.5 text-xs font-semibold text-[#1a1a1a]">{s.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[#1a1a1a]">{s.name}</span>
                  <span className="shrink-0 text-xs text-[#8e8e93]">{s.exchange}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* 快捷代码 */}
      <div className="mt-3 flex flex-wrap gap-2">
        {["AAPL", "TSLA", "NVDA", "GOOGL", "MSFT", "AMZN", "META"].map((t) => (
          <button
            key={t}
            onClick={() => fetchStock(t)}
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
          {stockData.isETF ? (
            <div className="rounded-2xl border border-[#e5e5e7] bg-[#f7f7f8] p-5 text-center">
              <p className="text-sm text-[#6e6e73]">ETF不适用个股财务指标（PE/PB/ROE等）</p>
              <p className="mt-1 text-xs text-[#8e8e93]">点击下方AI分析查看ETF专属分析报告</p>
            </div>
          ) : (
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
          )}

          {/* 行业基准对比 */}
          {stockData.financials?.sector ? (
            <IndustryBenchmark
              sector={stockData.financials.sector}
              pe={stockData.financials.pe}
              pb={stockData.financials.pb}
              roe={stockData.financials.roe}
              grossMargin={stockData.financials.grossMargin}
              debtToEquity={stockData.financials.debtToEquity}
            />
          ) : null}

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
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-sm text-[#8e8e93]">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#e5e5e7] border-t-[#1a1a1a]" />
                  {loadingStep}
                </div>
              </div>
            ) : null}

            {analysis ? (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-end gap-2">
                  <button
                    onClick={copyAnalysis}
                    className="rounded-md border border-[#d1d1d6] px-2.5 py-1.5 text-xs font-medium text-[#6e6e73] transition-colors hover:border-[#1a1a1a] hover:text-[#1a1a1a]"
                  >
                    {copyLabel}
                  </button>
                  <button
                    onClick={exportAnalysisImage}
                    disabled={exporting}
                    className="rounded-md border border-[#d1d1d6] px-2.5 py-1.5 text-xs font-medium text-[#6e6e73] transition-colors hover:border-[#1a1a1a] hover:text-[#1a1a1a] disabled:opacity-40"
                  >
                    {exporting ? "导出中…" : "导出图片"}
                  </button>
                </div>
                <div ref={reportRef} className="rounded-xl bg-[#f7f7f8] p-5">
                  <div className="mb-4 border-b border-[#e5e5e7] pb-3">
                    <p className="text-xs font-medium text-[#8e8e93]">费曼星 · AI选股分析</p>
                    <div className="mt-1 flex items-baseline justify-between gap-3">
                      <p className="text-base font-semibold text-[#1a1a1a]">{stockData.name}</p>
                      <p className="text-xs font-medium text-[#6e6e73]">{stockData.code}</p>
                    </div>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-7 text-[#1a1a1a]">{analysis}</div>
                  <p className="mt-5 border-t border-[#e5e5e7] pt-3 text-[11px] text-[#8e8e93]">
                    由费曼星生成，仅供研究参考，不构成投资建议。
                  </p>
                </div>
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

// 行业基准数据（硬编码，基于常见美股行业经验值）
const SECTOR_BENCHMARKS: Record<string, { pe: string; pb: string; roe: string; grossMargin: string; debtToEquity: string }> = {
  Technology: { pe: "25-35", pb: "5-15", roe: "15-25%", grossMargin: "50-70%", debtToEquity: "0.3-0.8" },
  "Consumer Cyclical": { pe: "15-25", pb: "3-8", roe: "10-20%", grossMargin: "30-50%", debtToEquity: "0.5-1.5" },
  "Financial Services": { pe: "8-15", pb: "1-3", roe: "8-15%", grossMargin: "—", debtToEquity: "1.5-3.0" },
  "Healthcare": { pe: "15-25", pb: "3-8", roe: "10-20%", grossMargin: "60-80%", debtToEquity: "0.3-0.8" },
  "Communication Services": { pe: "15-25", pb: "3-8", roe: "10-20%", grossMargin: "40-60%", debtToEquity: "0.5-1.2" },
  "Industrials": { pe: "15-22", pb: "2-5", roe: "10-18%", grossMargin: "25-40%", debtToEquity: "0.8-1.8" },
  "Consumer Defensive": { pe: "18-25", pb: "3-8", roe: "15-25%", grossMargin: "30-50%", debtToEquity: "0.5-1.2" },
  "Energy": { pe: "8-15", pb: "1-3", roe: "8-15%", grossMargin: "20-40%", debtToEquity: "0.3-0.8" },
  "Utilities": { pe: "15-20", pb: "1.5-3", roe: "8-12%", grossMargin: "40-60%", debtToEquity: "1.0-2.0" },
  "Real Estate": { pe: "25-40", pb: "1.5-3", roe: "8-12%", grossMargin: "—", debtToEquity: "0.5-1.5" },
  "Materials": { pe: "12-20", pb: "1.5-4", roe: "10-18%", grossMargin: "20-35%", debtToEquity: "0.5-1.2" },
};

function IndustryBenchmark({
  sector,
  pe,
  pb,
  roe,
  grossMargin,
  debtToEquity,
}: {
  sector: string;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  grossMargin: number | null;
  debtToEquity: number | null;
}) {
  const bench = SECTOR_BENCHMARKS[sector] ?? null;
  if (!bench) return null;

  const rows = [
    { label: "P/E", value: pe != null ? pe.toFixed(1) : "—", range: bench.pe },
    { label: "P/B", value: pb != null ? pb.toFixed(2) : "—", range: bench.pb },
    { label: "ROE", value: fmtPct(roe), range: bench.roe },
    { label: "毛利率", value: fmtPct(grossMargin), range: bench.grossMargin },
    { label: "负债/权益", value: debtToEquity != null ? debtToEquity.toFixed(2) : "—", range: bench.debtToEquity },
  ];

  return (
    <div className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-[#8e8e93]">行业基准对比 · {sector}</h3>
      <div className="overflow-hidden rounded-lg border border-[#e5e5e7]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e5e7] bg-[#f7f7f8]">
              <th className="px-4 py-2 text-left text-xs font-medium text-[#8e8e93]">指标</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-[#8e8e93]">当前值</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-[#8e8e93]">行业常见区间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-[#f2f2f3] last:border-0">
                <td className="px-4 py-2 text-[#1a1a1a]">{r.label}</td>
                <td className="px-4 py-2 text-right font-medium tabular-nums text-[#1a1a1a]">{r.value}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[#6e6e73]">{r.range}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[#8e8e93]">行业区间为硬编码经验值，仅供参考。建议与同行业个股实际数据交叉验证。</p>
    </div>
  );
}

function MiniChart({ candles, high52, low52 }: { candles: Candle[]; high52: number | null; low52: number | null }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const valid = candles.filter((c) => c.close != null) as Array<{ date: string; close: number }>;
  if (valid.length < 2) return null;

  const prices = valid.map((c) => c.close);
  const min = Math.min(...prices, low52 ?? Infinity);
  const max = Math.max(...prices, high52 ?? -Infinity);
  const range = max - min || 1;
  const W = 800;
  const H = 200;
  const padding = { top: 20, right: 50, bottom: 30, left: 50 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;

  const points = valid.map((c, i) => {
    const x = padding.left + (i / (valid.length - 1)) * chartW;
    const y = padding.top + chartH - ((c.close - min) / range) * chartH;
    return { x, y, close: c.close, date: c.date };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const yLabels = Array.from({ length: 5 }, (_, i) => {
    const val = max - (range * i) / 4;
    const y = padding.top + (chartH * i) / 4;
    return { val, y };
  });

  const firstPrice = valid[0].close;
  const lastPrice = valid[valid.length - 1].close;
  const isUp = lastPrice >= firstPrice;
  const lineColor = isUp ? "#16a34a" : "#dc2626";

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    if (x < padding.left || x > W - padding.right) {
      setHoverIdx(null);
      return;
    }
    const idx = Math.round(((x - padding.left) / chartW) * (valid.length - 1));
    setHoverIdx(Math.max(0, Math.min(idx, valid.length - 1)));
  }

  const hovered = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#8e8e93]">120日走势</h3>
        <span className={`text-xs font-medium ${isUp ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
          {isUp ? "▲" : "▼"} {(((lastPrice - firstPrice) / firstPrice) * 100).toFixed(2)}%
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
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
        {/* hover十字线 */}
        {hovered ? (
          <g>
            <line x1={hovered.x} y1={padding.top} x2={hovered.x} y2={H - padding.bottom} stroke="#8e8e93" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={hovered.x} cy={hovered.y} r="4" fill={lineColor} stroke="white" strokeWidth="2" />
            <rect x={hovered.x - 45} y={padding.top - 16} width="90" height="20" rx="4" fill="#1a1a1a" />
            <text x={hovered.x} y={padding.top - 2} textAnchor="middle" fontSize="10" fill="white" fontWeight="600">
              ${hovered.close.toFixed(2)} {hovered.date.slice(5)}
            </text>
          </g>
        ) : null}
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
  // Yahoo Finance比率类指标返回小数（0.15 = 15%），乘100转百分比
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
