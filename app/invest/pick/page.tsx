"use client";

import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { useRouter } from "next/navigation";
import { getTask, startTask, updateTaskProgress, type BackgroundTask } from "@/lib/background-task";

type SearchResult = {
  code: string;
  name: string;
  exchange: string | null;
  type: string;
  industry: string;
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

type PickAnalysisResult = {
  analysis: string;
  stockData: StockData;
  userNotes: string;
  generatedAt: string;
  history: PickHistoryRecord[];
};

type PickHistoryRecord = {
  id: string;
  code: string;
  name: string;
  date: string;
  fundamentalScore: number | null;
  technicalScore: number | null;
  valuationScore: number | null;
  liquidityScore?: number | null;
  sentimentScore?: number | null;
  totalScore: number | null;
  generatedAt?: string;
  stockData?: StockData;
  analysis?: string;
  userNotes?: string;
};

const PICK_TASK_KEY = "pick-analysis";
const PICK_HISTORY_KEY = "feimanstar_pick_history";
const PICK_STOCKDATA_KEY = "feimanstar_pick_stockdata";
const WATCHLIST_KEY = "feimanstar_watchlist";
const DEFAULT_WATCHLIST = [
  { symbol: "SPY", name: "标普500 ETF" },
  { symbol: "QQQ", name: "纳斯达克100 ETF" },
  { symbol: "DIA", name: "道琼斯 ETF" },
  { symbol: "IWM", name: "罗素2000 ETF" },
  { symbol: "UVXY", name: "波动率 ETF" },
];

function readWatchlist(): Array<{ symbol: string; name: string }> {
  try {
    const saved = localStorage.getItem(WATCHLIST_KEY);
    if (!saved) return DEFAULT_WATCHLIST;
    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_WATCHLIST;
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const symbol = typeof value.symbol === "string" ? value.symbol.trim().toUpperCase() : "";
      const name = typeof value.name === "string" ? value.name.trim() : symbol;
      return /^[A-Z]{1,6}$/.test(symbol) ? [{ symbol, name: name || symbol }] : [];
    }).slice(0, 20);
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

function readStoredStockData(): StockData | null {
  try {
    const saved = localStorage.getItem(PICK_STOCKDATA_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Partial<StockData>;
    if (
      typeof parsed.code !== "string"
      || typeof parsed.name !== "string"
      || !Array.isArray(parsed.candles)
    ) {
      return null;
    }
    return parsed as StockData;
  } catch {
    return null;
  }
}

function storeStockData(stockData: StockData) {
  try {
    localStorage.setItem(PICK_STOCKDATA_KEY, JSON.stringify(stockData));
  } catch {
    // localStorage不可用时不影响行情展示。
  }
}

function readPickHistory(): PickHistoryRecord[] {
  try {
    const saved = localStorage.getItem(PICK_HISTORY_KEY);
    return saved ? (JSON.parse(saved) as PickHistoryRecord[]).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function extractScore(analysis: string, labels: string[]): number | null {
  const normalized = analysis.replace(/\*\*/g, "");
  for (const label of labels) {
    const tableMatch = normalized.match(new RegExp(`\\|\\s*${label}\\s*\\|\\s*(\\d+(?:\\.\\d+)?)\\s*\\/\\s*10`, "i"));
    const textMatch = normalized.match(new RegExp(`${label}[^\\n\\d]{0,20}(\\d+(?:\\.\\d+)?)\\s*\\/\\s*10`, "i"));
    const value = Number(tableMatch?.[1] ?? textMatch?.[1]);
    if (Number.isFinite(value)) return Math.min(10, Math.max(0, value));
  }
  return null;
}

function storePickAnalysis(
  stockData: StockData,
  analysis: string,
  generatedAt: string,
  userNotes: string,
): PickHistoryRecord[] {
  const record: PickHistoryRecord = {
    id: `${Date.now()}-${stockData.code}`,
    code: stockData.code,
    name: stockData.name,
    date: generatedAt,
    fundamentalScore: extractScore(analysis, ["基本面"]),
    technicalScore: extractScore(analysis, ["技术面"]),
    valuationScore: extractScore(analysis, ["估值"]),
    liquidityScore: extractScore(analysis, ["流动性"]),
    sentimentScore: extractScore(analysis, ["市场情绪", "情绪"]),
    totalScore: extractScore(analysis, ["加权总分", "总分"]),
    generatedAt,
    stockData,
    analysis,
    userNotes,
  };
  const next = [record, ...readPickHistory()].slice(0, 20);
  try {
    localStorage.setItem(PICK_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // localStorage不可用时不影响分析结果。
  }
  return next;
}

function formatGeneratedTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function PickPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [userNotes, setUserNotes] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [loadingStep, setLoadingStep] = useState("AI分析进行中…");
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [error, setError] = useState("");
  const [copyLabel, setCopyLabel] = useState("复制");
  const [exporting, setExporting] = useState(false);
  const [pickHistory, setPickHistory] = useState<PickHistoryRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [inWatchlist, setInWatchlist] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const lastStockFetchRef = useRef(0);
  const lastAnalysisRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    setPickHistory(readPickHistory());
    const savedStockData = readStoredStockData();
    if (savedStockData) {
      setStockData(savedStockData);
      setQuery(savedStockData.code);
    }
    const task = getTask<PickAnalysisResult>(PICK_TASK_KEY);

    const applyResult = (result: PickAnalysisResult) => {
      if (!mountedRef.current) return;
      storeStockData(result.stockData);
      setStockData(result.stockData);
      setQuery(result.stockData.code);
      setUserNotes(result.userNotes);
      setAnalysis(result.analysis);
      setGeneratedAt(result.generatedAt);
      setPickHistory(result.history);
      setLoadingAI(false);
      setError("");
    };

    if (task?.status === "success" && task.result) {
      applyResult(task.result);
    } else if (task?.status === "error") {
      setLoadingAI(false);
      setError(task.error instanceof Error ? task.error.message : "AI分析暂时不可用");
    } else if (task?.status === "running") {
      setLoadingAI(true);
      setLoadingStep(task.progress || "AI分析进行中…");
      void task.promise.then(applyResult).catch(() => {
        if (!mountedRef.current) return;
        setLoadingAI(false);
        const latestTask = getTask<PickAnalysisResult>(PICK_TASK_KEY);
        setError(latestTask?.error instanceof Error ? latestTask.error.message : "AI分析暂时不可用");
      });
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setInWatchlist(Boolean(stockData && readWatchlist().some((item) => item.symbol === stockData.code)));
  }, [stockData]);

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
    const now = Date.now();
    if (now - lastStockFetchRef.current < 3_000) {
      setError("请稍候3秒再试");
      return;
    }
    lastStockFetchRef.current = now;
    setLoadingData(true);
    setError("");
    setStockData(null);
    setAnalysis("");
    setGeneratedAt(null);
    setShowSuggest(false);

    try {
      const res = await fetch(`/api/invest/stock?code=${encodeURIComponent(c)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "获取失败");
      }
      const json = await res.json();
      const nextStockData = json.data as StockData;
      storeStockData(nextStockData);
      setStockData(nextStockData);
      setQuery(nextStockData.code);
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
    const now = Date.now();
    if (now - lastAnalysisRef.current < 10_000) {
      setError("请稍候10秒再试");
      return;
    }
    lastAnalysisRef.current = now;
    const currentStockData = stockData;
    const currentUserNotes = userNotes;
    setLoadingAI(true);
    setLoadingStep("正在拉取新闻和市场快报…");
    setError("");
    setAnalysis("");
    setGeneratedAt(null);

    const task: BackgroundTask<PickAnalysisResult> = startTask(PICK_TASK_KEY, async () => {
      updateTaskProgress(PICK_TASK_KEY, "正在拉取新闻和市场快报…");
      const marketDataStr = JSON.stringify(currentStockData, null, 2);

      // 并行拉取新闻+市场快报
      const [newsRes, pulseRes] = await Promise.all([
        fetch(`/api/invest/news?code=${encodeURIComponent(currentStockData.code)}`).catch(() => null),
        fetch("/api/invest/market-pulse").catch(() => null),
      ]);
      const newsData = newsRes?.ok ? await newsRes.json() : null;
      const pulseData = pulseRes?.ok ? await pulseRes.json() : null;

      const generatingMessage = "AI正在生成深度分析报告，约15-90秒…";
      updateTaskProgress(PICK_TASK_KEY, generatingMessage);
      if (mountedRef.current) setLoadingStep(generatingMessage);
      const retryMessage = "首次请求响应较慢，DeepSeek正在自动重试…";
      const retryTimer = window.setTimeout(() => {
        updateTaskProgress(PICK_TASK_KEY, retryMessage);
        if (mountedRef.current) setLoadingStep(retryMessage);
      }, 90_000);
      let res: Response;
      try {
        res = await fetch("/api/invest/pick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stockName: currentStockData.name,
            stockCode: currentStockData.code,
            marketData: marketDataStr,
            news: newsData?.data?.news ?? [],
            nextEarnings: newsData?.data?.nextEarnings ?? null,
            marketPulse: pulseData?.data ?? null,
            userNotes: currentUserNotes,
          }),
        });
      } finally {
        window.clearTimeout(retryTimer);
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "AI分析失败，请重试");
      }

      // SSE流式读取
      const reader = res.body?.getReader();
      if (!reader) throw new Error("AI服务暂时不可用");
      const decoder = new TextDecoder();
      let analysis = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let data: { type: string; text?: string; message?: string };
          try { data = JSON.parse(line); } catch { continue; }
          if (data.type === "chunk") {
            analysis += data.text ?? "";
            if (mountedRef.current) setAnalysis(analysis);
          } else if (data.type === "patch") {
            analysis = data.text ?? analysis;
            if (mountedRef.current) setAnalysis(analysis);
          } else if (data.type === "error") {
            throw new Error(data.message ?? "AI分析失败");
          }
        }
      }

      if (!analysis.trim()) throw new Error("DeepSeek未返回有效内容，请重试");
      const nextGeneratedAt = new Date().toISOString();
      return {
        analysis,
        stockData: currentStockData,
        userNotes: currentUserNotes,
        generatedAt: nextGeneratedAt,
        history: storePickAnalysis(currentStockData, analysis, nextGeneratedAt, currentUserNotes),
      };
    });

    void task.promise.then((result) => {
      if (!mountedRef.current) return;
      setAnalysis(result.analysis);
      setGeneratedAt(result.generatedAt);
      setPickHistory(result.history);
      setLoadingAI(false);
    }).catch((taskError: unknown) => {
      if (!mountedRef.current) return;
      setError(taskError instanceof Error ? taskError.message : "AI分析暂时不可用");
      setLoadingAI(false);
    });
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
      link.download = `星启分析_${stockData.code}_${date}.png`;
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

  function deleteHistoryRecord(id: string) {
    const next = pickHistory.filter((record) => record.id !== id);
    setPickHistory(next);
    try {
      localStorage.setItem(PICK_HISTORY_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function restoreHistoryRecord(record: PickHistoryRecord) {
    if (!record.stockData || !record.analysis) {
      setError("这条旧记录没有完整行情和报告，请重新分析");
      return;
    }
    const restoredGeneratedAt = record.generatedAt || record.date;
    storeStockData(record.stockData);
    setStockData(record.stockData);
    setQuery(record.stockData.code);
    setAnalysis(record.analysis);
    setUserNotes(record.userNotes || "");
    setGeneratedAt(restoredGeneratedAt);
    setShowHistory(false);
    setError("");
    window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function addToWatchlist() {
    if (!stockData || inWatchlist) return;
    const current = readWatchlist();
    if (current.length >= 20) {
      setError("自选列表最多保存20项，请先删除一项");
      return;
    }
    const next = [...current, { symbol: stockData.code, name: stockData.name }];
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      setInWatchlist(true);
      setError("");
    } catch {
      setError("加入自选失败，请检查浏览器存储权限");
    }
  }

  function sendToChat() {
    if (!stockData) return;
    const params = new URLSearchParams({ stock: stockData.code, name: stockData.name });
    router.push(`/invest/chat?${params.toString()}`);
  }

  const pricePosition = stockData?.fiftyTwoWeekHigh && stockData?.fiftyTwoWeekLow && stockData?.price
    ? ((stockData.price - stockData.fiftyTwoWeekLow) / (stockData.fiftyTwoWeekHigh - stockData.fiftyTwoWeekLow)) * 100
    : null;
  const reportAgeHours = generatedAt ? (Date.now() - new Date(generatedAt).getTime()) / 3_600_000 : 0;
  const reportFreshness = reportAgeHours >= 72
    ? { text: "数据已过期，建议重新分析", tone: "bg-[var(--negative-bg)] text-[var(--negative)]" }
    : reportAgeHours >= 24
      ? { text: "数据可能已过期，建议重新分析", tone: "bg-[var(--warning-bg)] text-[var(--warning)]" }
      : null;
  const radarScores = [
    { label: "基本面", value: extractScore(analysis, ["基本面"]) },
    { label: "技术面", value: extractScore(analysis, ["技术面"]) },
    { label: "估值", value: extractScore(analysis, ["估值"]) },
    { label: "流动性", value: extractScore(analysis, ["流动性"]) },
    { label: "情绪", value: extractScore(analysis, ["市场情绪", "情绪"]) },
  ];

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI选股助手</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">输入美股代码或公司名称，拉取行情+财务数据，AI生成分析报告</p>
        </div>
        <button
          onClick={() => setShowHistory((visible) => !visible)}
          className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            showHistory
              ? "border-[var(--text)] bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text)]"
          }`}
        >
          历史对比{pickHistory.length > 0 ? ` ${pickHistory.length}` : ""}
        </button>
      </header>

      {showHistory ? (
        <div className="mb-8 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          {pickHistory.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">完成一次AI分析后，评分会出现在这里</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[820px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-xs text-[var(--text-muted)]">
                    <th className="px-4 py-3 text-left font-medium">代码</th>
                    <th className="px-4 py-3 text-left font-medium">名称</th>
                    <th className="px-4 py-3 text-left font-medium">日期</th>
                    <th className="px-4 py-3 text-right font-medium">基本面</th>
                    <th className="px-4 py-3 text-right font-medium">技术面</th>
                    <th className="px-4 py-3 text-right font-medium">估值</th>
                    <th className="px-4 py-3 text-right font-medium">总分</th>
                    <th className="px-4 py-3 text-center font-medium">趋势</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pickHistory]
                    .sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1))
                    .map((record) => {
                      const totalTone = record.totalScore == null
                        ? "bg-[var(--surface-muted)] text-[var(--text-muted)]"
                        : record.totalScore >= 7
                          ? "bg-[var(--positive-bg)] text-[var(--positive)]"
                          : record.totalScore >= 4
                            ? "bg-[var(--warning-bg)] text-[var(--warning)]"
                            : "bg-[var(--negative-bg)] text-[var(--negative)]";
                      return (
                        <tr
                          key={record.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => restoreHistoryRecord(record)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              restoreHistoryRecord(record);
                            }
                          }}
                          className="cursor-pointer border-b border-[var(--border)] transition-colors last:border-0 hover:bg-[var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text)]"
                        >
                          <td className="px-4 py-3 font-semibold">{record.code}</td>
                          <td className="max-w-40 truncate px-4 py-3 text-[var(--text-secondary)]">{record.name}</td>
                          <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{new Date(record.date).toLocaleDateString("zh-CN")}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{record.fundamentalScore ?? "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{record.technicalScore ?? "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{record.valuationScore ?? "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`inline-flex min-w-10 justify-center rounded-md px-2 py-1 font-semibold tabular-nums ${totalTone}`}>
                              {record.totalScore ?? "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <ScoreTrend current={record} history={pickHistory} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteHistoryRecord(record.id);
                              }}
                              className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--negative)]"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

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
              className="w-full rounded-xl border border-[var(--border-strong)] px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--text)]"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
            />
            {loadingSuggest ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text-muted)]" />
              </span>
            ) : null}
          </div>
          <button
            onClick={() => {
              const c = query.trim().toUpperCase();
              if (/^[A-Z]{1,6}$/.test(c)) fetchStock(c);
            }}
            disabled={loadingData || !query.trim()}
            className="shrink-0 rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loadingData ? "拉取中…" : "拉取行情"}
          </button>
        </div>

        {/* 联想下拉 */}
        {showSuggest && suggestions.length > 0 ? (
          <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
            {suggestions.map((s, i) => (
              <li key={s.code}>
                <button
                  onMouseDown={(e) => { e.preventDefault(); handleSuggestionClick(s); }}
                  onMouseEnter={() => setHighlightIdx(i)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === highlightIdx ? "bg-[var(--surface-subtle)]" : "bg-[var(--surface)]"
                  }`}
                >
                  <span className="shrink-0 rounded-md bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--text)]">{s.code}</span>
                  <span className="text-xs text-[var(--text-muted)]">|</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">{s.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">|</span>
                  <span className="max-w-32 shrink-0 truncate text-xs text-[var(--text-muted)]">{s.industry}</span>
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
            className="rounded-md bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--border)]"
          >
            {t}
          </button>
        ))}
      </div>

      {error ? <div className="mt-4 flex items-center gap-3"><p className="rounded-lg bg-[var(--negative-bg)] px-4 py-2.5 text-sm text-[var(--negative)]">{error}</p><button onClick={() => { setError(""); runAnalysis(); }} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-muted)]">重试</button></div> : null}

      {/* 骨架屏 */}
      {loadingData && !stockData ? (
        <div className="mt-8 animate-pulse space-y-4">
          <div className="h-32 rounded-2xl bg-[var(--surface-muted)]" />
          <div className="h-48 rounded-2xl bg-[var(--surface-muted)]" />
        </div>
      ) : null}

      {loadingAI && !stockData ? (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-muted)]">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text)]" />
          分析中…切换页面不会中断
        </div>
      ) : null}

      {/* 行情展示 */}
      {stockData ? (
        <div className="mt-8 space-y-4">
          {/* 价格卡片 */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-xl font-semibold">{stockData.name}</h2>
                  <span className="text-sm text-[var(--text-muted)]">{stockData.code}</span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
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
                    stockData.change != null && stockData.change >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
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
          ) : (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--text-muted)]">
              K线数据暂时不可用，不影响AI分析
            </div>
          )}

          {/* 52周价格位置 */}
          {pricePosition != null ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>52周低 ${stockData.fiftyTwoWeekLow?.toFixed(2)}</span>
                <span className="font-medium text-[var(--text)]">当前位置 {pricePosition.toFixed(0)}%</span>
                <span>52周高 ${stockData.fiftyTwoWeekHigh?.toFixed(2)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--negative)] via-[var(--warning)] to-[var(--positive)]"
                  style={{ width: `${Math.min(100, Math.max(0, pricePosition))}%` }}
                />
              </div>
            </div>
          ) : null}

          {/* 指标网格 */}
          {stockData.isETF ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5 text-center">
              <p className="text-sm text-[var(--text-secondary)]">ETF不适用个股财务指标（PE/PB/ROE等）</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">点击下方AI分析查看ETF专属分析报告</p>
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
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h3 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">公司简介</h3>
              <p className="text-sm leading-7 text-[var(--text)]">{stockData.financials.longBusinessSummary}</p>
            </div>
          ) : null}

          {/* AI分析 */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h3 className="mb-3 text-base font-semibold">AI选股分析</h3>
            <textarea
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="补充说明（可选）：如关注的指标、对比公司、特殊问题等"
              className="mb-3 w-full resize-none rounded-xl border border-[var(--border-strong)] px-4 py-3 text-sm outline-none focus:border-[var(--text)]"
            />
            <button
              onClick={runAnalysis}
              disabled={loadingAI}
              className="rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {loadingAI ? "AI分析中…" : analysis ? "重新分析" : "开始AI分析"}
            </button>

            {loadingAI ? (
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text)]" />
                  {loadingStep}
                </div>
              </div>
            ) : null}

            {analysis ? (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={addToWatchlist}
                    disabled={inWatchlist}
                    className="rounded-md border border-[var(--border-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)] disabled:cursor-default disabled:bg-[var(--surface-muted)] disabled:opacity-70"
                  >
                    {inWatchlist ? "已加入自选" : "加入自选"}
                  </button>
                  <button
                    onClick={sendToChat}
                    className="rounded-md border border-[var(--border-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
                  >
                    发送到对话
                  </button>
                  <span className="min-w-0 flex-1" />
                  <button
                    onClick={copyAnalysis}
                    className="rounded-md border border-[var(--border-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
                  >
                    {copyLabel}
                  </button>
                  <button
                    onClick={exportAnalysisImage}
                    disabled={exporting}
                    className="rounded-md border border-[var(--border-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)] disabled:opacity-40"
                  >
                    {exporting ? "导出中…" : "导出图片"}
                  </button>
                </div>
                <div ref={reportRef} className="rounded-xl bg-[var(--surface-subtle)] p-5">
                  <div className="mb-4 border-b border-[var(--border)] pb-3">
                    <p className="text-xs font-medium text-[var(--text-muted)]">星启 · AI选股分析</p>
                    <div className="mt-1 flex items-baseline justify-between gap-3">
                      <p className="text-base font-semibold text-[var(--text)]">{stockData.name}</p>
                      <p className="text-xs font-medium text-[var(--text-secondary)]">{stockData.code}</p>
                    </div>
                    {generatedAt ? (
                      <p className="mt-1 text-xs text-[var(--text-muted)]">生成时间：{formatGeneratedTime(generatedAt)}</p>
                    ) : null}
                  </div>
                  {reportFreshness ? (
                    <p className={`mb-4 rounded-lg px-3 py-2 text-xs font-medium ${reportFreshness.tone}`}>
                      {reportFreshness.text}
                    </p>
                  ) : null}
                  {radarScores.some((item) => item.value != null) ? (
                    <div className="mb-5 grid items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-[220px_1fr]">
                      <ScoreRadar scores={radarScores} />
                      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)]">
                              <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">评分维度</th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-[var(--text-muted)]">得分</th>
                            </tr>
                          </thead>
                          <tbody>
                            {radarScores.map((score) => (
                              <tr key={score.label} className="border-b border-[var(--border)] last:border-0">
                                <td className="px-3 py-2 text-[var(--text-secondary)]">{score.label}</td>
                                <td className="px-3 py-2 text-right font-semibold tabular-nums">{score.value == null ? "—" : `${score.value}/10`}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                  <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--text)]">{analysis}</div>
                  <p className="mt-5 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)]">
                    由星启生成，仅供研究参考，不构成投资建议。
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="mt-10 text-xs text-[var(--text-muted)]">
        行情数据来自 Yahoo Finance，可能存在 15 分钟延迟。本工具仅供研究参考，不构成投资建议。
      </p>
    </div>
  );
}

/* === 组件 === */

type RadarScore = { label: string; value: number | null };

function ScoreRadar({ scores }: { scores: RadarScore[] }) {
  const center = 100;
  const radius = 62;
  const labelRadius = 85;
  const angleFor = (index: number) => -Math.PI / 2 + (index * Math.PI * 2) / scores.length;
  const pointAt = (index: number, scale: number, targetRadius = radius) => ({
    x: center + Math.cos(angleFor(index)) * targetRadius * scale,
    y: center + Math.sin(angleFor(index)) * targetRadius * scale,
  });
  const polygon = (scale: number) => scores
    .map((_, index) => {
      const point = pointAt(index, scale);
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    })
    .join(" ");
  const valuePolygon = scores
    .map((score, index) => {
      const value = score.value == null ? 0 : Math.min(10, Math.max(0, score.value));
      const point = pointAt(index, value / 10);
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div>
      <p className="mb-1 text-center text-xs font-medium text-[var(--text-muted)]">五维评分雷达</p>
      <svg viewBox="0 0 200 200" className="mx-auto h-48 w-48" role="img" aria-label="五维评分雷达图">
        {[0.2, 0.4, 0.6, 0.8, 1].map((scale) => (
          <polygon
            key={scale}
            points={polygon(scale)}
            fill="none"
            stroke="var(--border)"
            strokeWidth={scale === 1 ? 1.5 : 1}
          />
        ))}
        {scores.map((score, index) => {
          const edge = pointAt(index, 1);
          const label = pointAt(index, 1, labelRadius);
          return (
            <g key={score.label}>
              <line x1={center} y1={center} x2={edge.x} y2={edge.y} stroke="var(--border)" strokeWidth="1" />
              <text
                x={label.x}
                y={label.y + 3}
                textAnchor="middle"
                fontSize="10"
                fontWeight="500"
                fill="var(--text-secondary)"
              >
                {score.label}
              </text>
            </g>
          );
        })}
        <polygon
          points={valuePolygon}
          fill="var(--positive)"
          fillOpacity="0.18"
          stroke="var(--positive)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {scores.map((score, index) => {
          const value = score.value == null ? 0 : Math.min(10, Math.max(0, score.value));
          const point = pointAt(index, value / 10);
          return <circle key={score.label} cx={point.x} cy={point.y} r="3" fill="var(--positive)" />;
        })}
      </svg>
    </div>
  );
}

function ScoreTrend({ current, history }: { current: PickHistoryRecord; history: PickHistoryRecord[] }) {
  const currentTime = new Date(current.date).getTime();
  const records = history
    .filter((record) => (
      record.code === current.code
      && record.totalScore != null
      && new Date(record.date).getTime() <= currentTime
    ))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-3);

  if (records.length < 2) {
    return <span className="block text-center text-[var(--text-muted)]">—</span>;
  }

  const scores = records.map((record) => record.totalScore as number);
  const first = scores[0];
  const last = scores[scores.length - 1];
  const change = last - first;
  const direction = change > 0.05 ? "up" : change < -0.05 ? "down" : "flat";
  const color = direction === "up" ? "var(--positive)" : direction === "down" ? "var(--negative)" : "var(--text-muted)";
  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "—";
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  const points = scores.map((score, index) => {
    const x = scores.length === 1 ? 32 : 3 + (index / (scores.length - 1)) * 58;
    const y = 20 - ((score - min) / range) * 16;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <div className="flex items-center justify-center gap-1" title={`最近${records.length}次：${scores.join(" → ")}`}>
      <svg viewBox="0 0 64 24" className="h-6 w-16" role="img" aria-label={`${current.code}评分趋势${arrow}`}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.split(" ").map((point, index) => {
          const [cx, cy] = point.split(",");
          return <circle key={`${point}-${index}`} cx={cx} cy={cy} r="2" fill={color} />;
        })}
      </svg>
      <span className="text-xs font-semibold" style={{ color }}>{arrow}</span>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
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
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-muted)]">行业基准对比 · {sector}</h3>
      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)]">
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)]">指标</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)]">当前值</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)]">行业常见区间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-2 text-[var(--text)]">{r.label}</td>
                <td className="px-4 py-2 text-right font-medium tabular-nums text-[var(--text)]">{r.value}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{r.range}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">行业区间为硬编码经验值，仅供参考。建议与同行业个股实际数据交叉验证。</p>
    </div>
  );
}

function MiniChart({ candles, high52, low52 }: { candles: Candle[]; high52: number | null; low52: number | null }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const valid = candles.filter((c) => c.close != null) as Array<{ date: string; close: number; volume: number | null }>;
  if (valid.length < 2) return null;

  const prices = valid.map((c) => c.close);
  const volumes = valid.map((c) => c.volume ?? 0);
  const maxVol = Math.max(...volumes, 1);
  const min = Math.min(...prices, low52 ?? Infinity);
  const max = Math.max(...prices, high52 ?? -Infinity);
  const range = max - min || 1;
  const W = 800;
  const H = 280;
  const padding = { top: 20, right: 50, bottom: 60, left: 50 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const volH = 40;
  const priceH = chartH - volH - 10;

  // MA20
  const ma20: Array<number | null> = valid.map((_, i) => {
    if (i < 19) return null;
    const slice = prices.slice(i - 19, i + 1);
    return slice.reduce((a, b) => a + b, 0) / 20;
  });
  // MA60
  const ma60: Array<number | null> = valid.map((_, i) => {
    if (i < 59) return null;
    const slice = prices.slice(i - 59, i + 1);
    return slice.reduce((a, b) => a + b, 0) / 60;
  });

  const points = valid.map((c, i) => {
    const x = padding.left + (i / (valid.length - 1)) * chartW;
    const y = padding.top + priceH - ((c.close - min) / range) * priceH;
    return { x, y, close: c.close, date: c.date, volume: c.volume };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const ma20Path = ma20.map((ma, i) => {
    if (ma == null) return null;
    const x = padding.left + (i / (valid.length - 1)) * chartW;
    const y = padding.top + priceH - ((ma - min) / range) * priceH;
    return { x, y };
  }).filter(Boolean);
  const ma20D = ma20Path.map((p, i) => `${i === 0 ? "M" : "L"} ${p!.x.toFixed(1)} ${p!.y.toFixed(1)}`).join(" ");

  const ma60Path = ma60.map((ma, i) => {
    if (ma == null) return null;
    const x = padding.left + (i / (valid.length - 1)) * chartW;
    const y = padding.top + priceH - ((ma - min) / range) * priceH;
    return { x, y };
  }).filter(Boolean);
  const ma60D = ma60Path.map((p, i) => `${i === 0 ? "M" : "L"} ${p!.x.toFixed(1)} ${p!.y.toFixed(1)}`).join(" ");

  const yLabels = Array.from({ length: 5 }, (_, i) => {
    const val = max - (range * i) / 4;
    const y = padding.top + (priceH * i) / 4;
    return { val, y };
  });

  const firstPrice = valid[0].close;
  const lastPrice = valid[valid.length - 1].close;
  const isUp = lastPrice >= firstPrice;
  const lineColor = isUp ? "var(--positive)" : "var(--negative)";
  const volBottom = padding.top + priceH + 10;

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
  const hoveredMA20 = hoverIdx != null ? ma20[hoverIdx] : null;
  const hoveredMA60 = hoverIdx != null ? ma60[hoverIdx] : null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-muted)]">120日走势</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "var(--positive)" }}></span>
            MA20
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-orange-500"></span>
            MA60
          </span>
          <span className={`font-medium ${isUp ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
            {isUp ? "▲" : "▼"} {(((lastPrice - firstPrice) / firstPrice) * 100).toFixed(2)}%
          </span>
        </div>
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
            <line x1={padding.left} y1={yl.y} x2={W - padding.right} y2={yl.y} stroke="var(--border)" strokeWidth="1" />
            <text x={padding.left - 8} y={yl.y + 3} textAnchor="end" fontSize="10" fill="var(--text-muted)">
              ${yl.val.toFixed(2)}
            </text>
          </g>
        ))}
        {/* 成交量柱 */}
        {points.map((p, i) => {
          const h = (volumes[i] / maxVol) * volH;
          return (
            <rect
              key={`vol-${i}`}
              x={p.x - 2}
              y={volBottom + volH - h}
              width={3}
              height={h}
              fill={p.close >= (valid[i-1]?.close ?? p.close) ? "var(--positive)" : "var(--negative)"}
              opacity={0.3}
            />
          );
        })}
        {/* 成交量标签 */}
        <text x={padding.left} y={volBottom - 4} fontSize="9" fill="var(--text-muted)">成交量</text>
        {/* MA60 */}
        {ma60D && <path d={ma60D} fill="none" stroke="#f97316" strokeWidth="1.5" opacity={0.8} />}
        {/* MA20 */}
        {ma20D && <path d={ma20D} fill="none" stroke="var(--positive)" strokeWidth="1.5" opacity={0.8} />}
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
            <line x1={hovered.x} y1={padding.top} x2={hovered.x} y2={H - padding.bottom} stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={hovered.x} cy={hovered.y} r="4" fill={lineColor} stroke="var(--surface)" strokeWidth="2" />
            <rect x={hovered.x - 50} y={padding.top - 16} width={100} height={20} rx="4" fill="var(--primary)" />
            <text x={hovered.x} y={padding.top - 2} textAnchor="middle" fontSize="10" fill="var(--primary-foreground)" fontWeight="600">
              ${hovered.close.toFixed(2)} {hovered.date.slice(5)}
            </text>
            {hoveredMA20 != null && (
              <text x={hovered.x} y={hovered.y - 10} textAnchor="middle" fontSize="9" fill="var(--positive)">
                MA20: ${hoveredMA20.toFixed(2)}
              </text>
            )}
            {hoveredMA60 != null && (
              <text x={hovered.x} y={hovered.y + 14} textAnchor="middle" fontSize="9" fill="#f97316">
                MA60: ${hoveredMA60.toFixed(2)}
              </text>
            )}
          </g>
        ) : null}
        {/* X轴日期 */}
        <text x={padding.left} y={H - 8} fontSize="10" fill="var(--text-muted)">
          {valid[0].date.slice(5)}
        </text>
        <text x={W - padding.right} y={H - 8} fontSize="10" fill="var(--text-muted)" textAnchor="end">
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
