"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getTask, startTask, updateTaskProgress, type BackgroundTask } from "@/lib/background-task";

type ReviewRecord = {
  id: string;
  date: string;
  trades: string;
  strategy: string;
  questions: string;
  totalCapital?: number;
  analysis: string;
};

type ReviewAnalysisResult = {
  analysis: string;
  trades: string;
  strategy: string;
  questions: string;
  totalCapital: number;
  record: ReviewRecord;
  tradeStats: TradeStats;
  positionCheck: PositionCheck;
  parseMode: "ai" | "fallback";
};

const STORAGE_KEY = "feimanstar_reviews";
const REVIEW_TASK_KEY = "review-analysis";
const REVIEW_DRAFT_KEY = "feimanstar_review_draft";

type ReviewDraft = {
  trades: string;
  strategy: string;
  questions: string;
  totalCapital: string;
};

function readReviewDraft(): ReviewDraft | null {
  try {
    const saved = localStorage.getItem(REVIEW_DRAFT_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Partial<ReviewDraft>;
    if (typeof parsed.trades !== "string" || typeof parsed.strategy !== "string" || typeof parsed.questions !== "string") {
      return null;
    }
    return {
      trades: parsed.trades,
      strategy: parsed.strategy,
      questions: parsed.questions,
      totalCapital: typeof parsed.totalCapital === "string" ? parsed.totalCapital : "100000",
    };
  } catch {
    return null;
  }
}

type ParsedTrade = {
  date?: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  raw?: string;
};

type TradeStats = {
  totalTrades: number;
  winRate: number | null;
  totalPnl: number;
  profitLossRatio: number | null;
  closedPnls: number[];
};

type PositionViolation = {
  tradeNumber: number;
  symbol: string;
  amount: number;
  ratio: number;
  rule: string;
};

type PositionCheck = {
  totalTrades: number;
  violationCount: number;
  violations: PositionViolation[];
};

type SummaryPeriod = "week" | "month";

function toPositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const number = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseTradeEntry(raw: string): ParsedTrade | null {
  const text = raw.trim();
  if (!text) return null;

  const csv = text.split(",").map((part) => part.trim());
  if (csv.length >= 5 && /^(BUY|SELL)$/i.test(csv[2])) {
    const quantity = toPositiveNumber(csv[3]);
    const price = toPositiveNumber(csv[4]);
    if (quantity && price && /^[A-Z]{1,6}$/i.test(csv[1])) {
      return {
        symbol: csv[1].toUpperCase(),
        side: csv[2].toUpperCase() === "BUY" ? "buy" : "sell",
        quantity,
        price,
        raw: text,
      };
    }
  }

  const sideMatch = text.match(/方向\s*[:：]\s*(买入|卖出|BUY|SELL)/i)
    ?? text.match(/(?:^|\s)(买入|卖出|BUY|SELL)(?:\s|$)/i);
  if (!sideMatch) return null;

  const side = /^(买入|BUY)$/i.test(sideMatch[1]) ? "buy" : "sell";
  const symbolMatch = text.match(/代码\s*[:：]\s*([A-Z]{1,6})/i)
    ?? text.match(/(?:买入|卖出|BUY|SELL)\s+([A-Z]{1,6})/i);
  const quantityMatch = text.match(/(?:数量|QTY)\s*[:：]?\s*([\d,.]+)/i)
    ?? text.match(/([\d,.]+)\s*(?:股|SHARES?)/i);
  const priceMatch = text.match(/(?:价格|PRICE)\s*[:：]?\s*\$?\s*([\d,.]+)/i)
    ?? text.match(/@\s*\$?\s*([\d,.]+)/);

  const quantity = toPositiveNumber(quantityMatch?.[1]);
  const price = toPositiveNumber(priceMatch?.[1]);
  if (!symbolMatch || !quantity || !price) return null;

  return {
    symbol: symbolMatch[1].toUpperCase(),
    side,
    quantity,
    price,
    raw: text,
  };
}

function parseTrades(text: string): ParsedTrade[] {
  const entries: ParsedTrade[] = [];
  const blocks = text.split(/\n\s*-{3,}\s*\n/);

  for (const block of blocks) {
    const isFieldBlock = /(?:方向|代码|数量|价格)\s*[:：]/.test(block);
    if (isFieldBlock) {
      const entry = parseTradeEntry(block);
      if (entry) entries.push(entry);
      continue;
    }

    for (const line of block.split(/\r?\n/)) {
      const entry = parseTradeEntry(line);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

function calculateTradeStatsFromEntries(entries: ParsedTrade[], explicitPnlText = ""): TradeStats {
  const openLots = new Map<string, Array<{ quantity: number; price: number }>>();
  const closedPnls: number[] = [];

  for (const entry of entries) {
    if (entry.side === "buy") {
      const lots = openLots.get(entry.symbol) ?? [];
      lots.push({ quantity: entry.quantity, price: entry.price });
      openLots.set(entry.symbol, lots);
      continue;
    }

    const lots = openLots.get(entry.symbol) ?? [];
    let remaining = entry.quantity;
    let tradePnl = 0;
    let matchedQuantity = 0;

    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const matched = Math.min(remaining, lot.quantity);
      tradePnl += (entry.price - lot.price) * matched;
      matchedQuantity += matched;
      remaining -= matched;
      lot.quantity -= matched;
      if (lot.quantity <= 0) lots.shift();
    }

    if (matchedQuantity > 0) closedPnls.push(tradePnl);
    openLots.set(entry.symbol, lots);
  }

  if (closedPnls.length === 0 && explicitPnlText) {
    const explicitPnls = Array.from(
      explicitPnlText.matchAll(/(?:盈亏|P\/?L|PNL)\s*[:：]?\s*([+-]?\s*\$?\s*[\d,.]+)/gi),
      (match) => Number(match[1].replace(/[$,\s]/g, "")),
    ).filter(Number.isFinite);
    closedPnls.push(...explicitPnls);
  }

  const wins = closedPnls.filter((pnl) => pnl > 0);
  const losses = closedPnls.filter((pnl) => pnl < 0);
  const averageWin = wins.length > 0 ? wins.reduce((sum, pnl) => sum + pnl, 0) / wins.length : null;
  const averageLoss = losses.length > 0
    ? Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0) / losses.length)
    : null;

  return {
    totalTrades: closedPnls.length,
    winRate: closedPnls.length > 0 ? (wins.length / closedPnls.length) * 100 : null,
    totalPnl: closedPnls.reduce((sum, pnl) => sum + pnl, 0),
    profitLossRatio: averageWin != null && averageLoss != null
      ? averageWin / averageLoss
      : averageWin != null
        ? Number.POSITIVE_INFINITY
        : null,
    closedPnls,
  };
}

function calculateTradeStats(text: string): TradeStats {
  return calculateTradeStatsFromEntries(parseTrades(text), text);
}

function calculatePositionCheck(entries: ParsedTrade[], sourceText: string, totalCapital: number): PositionCheck {
  const normalizedCapital = Number.isFinite(totalCapital) && totalCapital > 0 ? totalCapital : 100_000;
  const sourceLines = sourceText.split(/\r?\n/);
  const violations: PositionViolation[] = [];

  entries.forEach((entry, index) => {
    const context = entry.raw
      || sourceLines.find((line) => line.toUpperCase().includes(entry.symbol))
      || "";
    const isOption = /期权|OPTION|\bCALL\b|\bPUT\b/i.test(context);
    const isDayTrade = isOption && /日内|DAY\s*TRADE|INTRADAY|0DTE/i.test(context);
    const amount = entry.quantity * entry.price * (isOption ? 100 : 1);
    const ratio = amount / normalizedCapital;
    const limit = isDayTrade ? 0.05 * 0.2 : isOption ? 0.05 : 0.15;
    if (ratio <= limit) return;
    violations.push({
      tradeNumber: index + 1,
      symbol: entry.symbol,
      amount,
      ratio,
      rule: isDayTrade ? "日内期权超过可操作资金20%" : isOption ? "期权资金超过总资金5%" : "单笔交易超过总资金15%",
    });
  });

  return { totalTrades: entries.length, violationCount: violations.length, violations };
}

function normalizeAITrades(value: unknown): ParsedTrade[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const trade = item as Record<string, unknown>;
    const side = trade.side === "buy" || trade.side === "sell" ? trade.side : null;
    const quantity = Number(trade.quantity);
    const price = Number(trade.price);
    const symbol = typeof trade.code === "string" ? trade.code.trim().toUpperCase() : "";
    if (!side || !symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
      return [];
    }
    return [{
      date: typeof trade.date === "string" ? trade.date : "",
      symbol,
      side,
      quantity,
      price,
    }];
  });
}

function formatPnl(value: number, hasTrades: boolean): string {
  if (!hasTrades) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export default function ReviewPage() {
  const [trades, setTrades] = useState("");
  const [strategy, setStrategy] = useState("");
  const [questions, setQuestions] = useState("");
  const [totalCapital, setTotalCapital] = useState("100000");
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ReviewRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [resolvedTradeStats, setResolvedTradeStats] = useState<TradeStats | null>(null);
  const [resolvedPositionCheck, setResolvedPositionCheck] = useState<PositionCheck | null>(null);
  const [statsSource, setStatsSource] = useState<"local" | "ai" | "fallback">("local");
  const [progressStep, setProgressStep] = useState("正在解析交易记录…");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const mountedRef = useRef(false);
  const localTradeStats = useMemo(() => calculateTradeStats(trades), [trades]);
  const tradeStats = resolvedTradeStats ?? localTradeStats;
  const parsedCapital = Number(totalCapital.replace(/[$,\s]/g, ""));
  const localPositionCheck = useMemo(
    () => calculatePositionCheck(parseTrades(trades), trades, parsedCapital),
    [parsedCapital, trades],
  );
  const positionCheck = resolvedPositionCheck ?? localPositionCheck;

  useEffect(() => {
    mountedRef.current = true;
    const draft = readReviewDraft();
    if (draft) {
      setTrades(draft.trades);
      setStrategy(draft.strategy);
      setQuestions(draft.questions);
      setTotalCapital(draft.totalCapital);
    }
    setDraftHydrated(true);
    const task = getTask<ReviewAnalysisResult>(REVIEW_TASK_KEY);

    const applyResult = (result: ReviewAnalysisResult) => {
      if (!mountedRef.current) return;
      setTrades(result.trades);
      setStrategy(result.strategy);
      setQuestions(result.questions);
      setTotalCapital(String(result.totalCapital));
      setAnalysis(result.analysis);
      setResolvedTradeStats(result.tradeStats);
      setResolvedPositionCheck(result.positionCheck);
      setStatsSource(result.parseMode);
      setHistory((previous) => [
        result.record,
        ...previous.filter((record) => record.id !== result.record.id),
      ].slice(0, 20));
      setLoading(false);
      setError("");
    };

    if (task?.status === "success" && task.result) {
      applyResult(task.result);
    } else if (task?.status === "error") {
      setLoading(false);
      setError(task.error instanceof Error ? task.error.message : "AI分析暂时不可用，请稍后重试");
    } else if (task?.status === "running") {
      setLoading(true);
      setProgressStep(task.progress || "AI处理中…");
      void task.promise.then(applyResult).catch(() => {
        if (!mountedRef.current) return;
        setLoading(false);
        const latestTask = getTask<ReviewAnalysisResult>(REVIEW_TASK_KEY);
        setError(latestTask?.error instanceof Error ? latestTask.error.message : "AI分析暂时不可用，请稍后重试");
      });
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    try {
      localStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({ trades, strategy, questions, totalCapital }));
    } catch {
      // localStorage不可用时不影响复盘分析。
    }
  }, [draftHydrated, questions, strategy, totalCapital, trades]);

  // 加载历史
  function loadHistory() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const records: ReviewRecord[] = JSON.parse(saved);
        setHistory(records.sort((a, b) => b.date.localeCompare(a.date)));
      }
    } catch {
      // ignore
    }
    setShowHistory(true);
  }

  function getStoredReviews(): ReviewRecord[] {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? (JSON.parse(saved) as ReviewRecord[]) : [];
    } catch {
      return [];
    }
  }

  async function generateSummary(period: SummaryPeriod) {
    if (summaryLoading) return;
    const now = new Date();
    const start = period === "month"
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : (() => {
          const value = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const dayOffset = value.getDay() === 0 ? 6 : value.getDay() - 1;
          value.setDate(value.getDate() - dayOffset);
          return value;
        })();
    const records = getStoredReviews()
      .filter((record) => {
        const date = new Date(record.date);
        return !Number.isNaN(date.getTime()) && date >= start && date <= now;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    setShowHistory(true);
    setHistory(getStoredReviews().sort((a, b) => b.date.localeCompare(a.date)));
    setSummaryPeriod(period);
    setSummary("");
    setSummaryError("");
    if (records.length === 0) {
      setSummaryError(period === "week" ? "本周还没有复盘记录" : "本月还没有复盘记录");
      return;
    }

    setSummaryLoading(true);
    try {
      const response = await fetch("/api/invest/review-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period,
          records: records.map((record) => ({
            date: record.date,
            trades: record.trades,
            analysis: record.analysis,
          })),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "摘要生成失败");
      setSummary(json.data?.summary || "");
    } catch (summaryLoadError) {
      setSummaryError(summaryLoadError instanceof Error ? summaryLoadError.message : "摘要生成失败");
    } finally {
      setSummaryLoading(false);
    }
  }

  function exportSummaryMarkdown() {
    if (!summary || !summaryPeriod) return;
    const date = new Date().toISOString().slice(0, 10);
    const title = summaryPeriod === "week" ? "星启投资周报" : "星启投资月报";
    const blob = new Blob([`# ${title}\n\n${summary}\n`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title}_${date}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function saveReview(record: ReviewRecord) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const records: ReviewRecord[] = saved ? JSON.parse(saved) : [];
      records.push(record);
      // 只保留最近20条
      const trimmed = records.slice(-20);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // ignore
    }
  }

  function deleteReview(id: string) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const records: ReviewRecord[] = saved ? JSON.parse(saved) : [];
      const filtered = records.filter((r) => r.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      setHistory(filtered.sort((a, b) => b.date.localeCompare(a.date)));
    } catch {
      // ignore
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!trades.trim() || loading) return;
    const currentTrades = trades;
    const currentStrategy = strategy;
    const currentQuestions = questions;
    const currentTotalCapital = Number(totalCapital.replace(/[$,\s]/g, "")) || 100_000;
    setLoading(true);
    setProgressStep("正在用AI解析交易记录…");
    setError("");
    setAnalysis("");
    setResolvedTradeStats(null);
    setResolvedPositionCheck(null);
    setStatsSource("local");

    const task: BackgroundTask<ReviewAnalysisResult> = startTask(REVIEW_TASK_KEY, async () => {
      updateTaskProgress(REVIEW_TASK_KEY, "正在用AI解析交易记录…");
      let parsedStats: TradeStats;
      let parsedPositionCheck: PositionCheck;
      let parseMode: "ai" | "fallback" = "fallback";

      try {
        const parseResponse = await fetch("/api/invest/parse-trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trades: currentTrades }),
        });
        if (!parseResponse.ok) throw new Error("parse_failed");
        const parseJson = await parseResponse.json();
        const parsedTrades = normalizeAITrades(parseJson.data?.trades);
        if (parsedTrades.length === 0) throw new Error("empty_trades");
        parsedStats = calculateTradeStatsFromEntries(parsedTrades);
        parsedPositionCheck = calculatePositionCheck(parsedTrades, currentTrades, currentTotalCapital);
        parseMode = "ai";
        updateTaskProgress(REVIEW_TASK_KEY, "交易解析完成，正在生成复盘报告…");
        if (mountedRef.current) {
          setResolvedTradeStats(parsedStats);
          setResolvedPositionCheck(parsedPositionCheck);
          setStatsSource("ai");
          setProgressStep("交易解析完成，正在生成复盘报告…");
        }
      } catch {
        const fallbackTrades = parseTrades(currentTrades);
        parsedStats = calculateTradeStatsFromEntries(fallbackTrades, currentTrades);
        parsedPositionCheck = calculatePositionCheck(fallbackTrades, currentTrades, currentTotalCapital);
        updateTaskProgress(REVIEW_TASK_KEY, "AI解析失败，已用本地规则解析；正在生成复盘报告…");
        if (mountedRef.current) {
          setResolvedTradeStats(parsedStats);
          setResolvedPositionCheck(parsedPositionCheck);
          setStatsSource("fallback");
          setProgressStep("AI解析失败，已用本地规则解析；正在生成复盘报告…");
        }
      }

      const retryMessage = "首次请求响应较慢，DeepSeek正在自动重试…";
      const retryTimer = window.setTimeout(() => {
        updateTaskProgress(REVIEW_TASK_KEY, retryMessage);
        if (mountedRef.current) setProgressStep(retryMessage);
      }, 90_000);
      let res: Response;
      try {
        res = await fetch("/api/invest/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trades: currentTrades,
            strategy: currentStrategy,
            questions: currentQuestions,
            totalCapital: currentTotalCapital,
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
      let result = "";
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
            result += data.text ?? "";
            if (mountedRef.current) setAnalysis(result);
          } else if (data.type === "patch") {
            result = data.text ?? result;
            if (mountedRef.current) setAnalysis(result);
          } else if (data.type === "error") {
            throw new Error(data.message ?? "AI分析失败");
          }
        }
      }

      if (!result.trim()) throw new Error("DeepSeek未返回有效内容，请重试");
      const record: ReviewRecord = {
        id: `${Date.now()}`,
        date: new Date().toISOString(),
        trades: currentTrades,
        strategy: currentStrategy,
        questions: currentQuestions,
        totalCapital: currentTotalCapital,
        analysis: result,
      };
      saveReview(record);

      return {
        analysis: result,
        trades: currentTrades,
        strategy: currentStrategy,
        questions: currentQuestions,
        totalCapital: currentTotalCapital,
        record,
        tradeStats: parsedStats,
        positionCheck: parsedPositionCheck,
        parseMode,
      };
    });

    void task.promise.then((result) => {
      if (!mountedRef.current) return;
      setAnalysis(result.analysis);
      setResolvedTradeStats(result.tradeStats);
      setResolvedPositionCheck(result.positionCheck);
      setStatsSource(result.parseMode);
      setHistory((previous) => [
        result.record,
        ...previous.filter((record) => record.id !== result.record.id),
      ].slice(0, 20));
      setLoading(false);
    }).catch((taskError: unknown) => {
      if (!mountedRef.current) return;
      setError(taskError instanceof Error ? taskError.message : "AI分析暂时不可用，请稍后重试");
      setLoading(false);
    });
  }

  const templates = [
    {
      name: "简洁版",
      content: `2024-07-15 买入 AAPL 100股 @ $185.00
2024-07-22 卖出 AAPL 100股 @ $187.50
2024-07-20 买入 TSLA 50股 @ $248.00
2024-08-01 卖出 TSLA 50股 @ $235.00 止损`,
    },
    {
      name: "详细版",
      content: `日期：2024-07-15
代码：AAPL
方向：买入
数量：100股
价格：$185.00
理由：突破20日均线，放量
仓位：占总资金15%

---
日期：2024-07-22
代码：AAPL
方向：卖出
数量：100股
价格：$187.50
理由：到目标价，止盈
盈亏：+$250 (+1.35%)`,
    },
    {
      name: "CSV版",
      content: `date,symbol,side,qty,price,note
2024-07-15,AAPL,BUY,100,185.00,breakout
2024-07-22,AAPL,SELL,100,187.50,target hit
2024-07-20,TSLA,BUY,50,248.00,earnings play
2024-08-01,TSLA,SELL,50,235.00,stop loss`,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">交易复盘</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">粘贴交易记录，AI做归因分析——盈亏来源、行为偏差、改进建议</p>
        </div>
        <button
          onClick={loadHistory}
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--text)]"
        >
          历史复盘
        </button>
      </header>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">交易记录 <span className="text-[var(--negative)]">*</span></label>
            <div className="flex gap-1.5">
              {templates.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => {
                    setTrades(t.content);
                    setResolvedTradeStats(null);
                    setResolvedPositionCheck(null);
                    setStatsSource("local");
                  }}
                  className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--border)]"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">支持任意格式，只要AI能读懂。每笔交易一行：日期、方向、代码、数量、价格</p>
          <textarea
            value={trades}
            onChange={(e) => {
              setTrades(e.target.value);
              setResolvedTradeStats(null);
              setResolvedPositionCheck(null);
              setStatsSource("local");
            }}
            rows={8}
            maxLength={8000}
            placeholder="点击上方模板按钮快速填充，或直接粘贴你的交易记录"
            className="mt-2 w-full resize-none rounded-xl border border-[var(--border-strong)] px-4 py-3 font-mono text-xs leading-6 outline-none focus:border-[var(--text)]"
          />
          <div className="mt-1 flex justify-between text-xs text-[var(--text-muted)]">
            <span>支持中英文、任意分隔符</span>
            <span>{trades.length}/8000</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium">总资金 <span className="text-[var(--text-muted)]">（美元）</span></label>
            <input
              type="number"
              min="1000"
              max="1000000000"
              step="1000"
              value={totalCapital}
              onChange={(event) => {
                setTotalCapital(event.target.value);
                setResolvedPositionCheck(null);
              }}
              placeholder="100000"
              className="mt-2 w-full rounded-xl border border-[var(--border-strong)] px-4 py-3 text-sm outline-none focus:border-[var(--text)]"
            />
            <p className="mt-1 text-xs text-[var(--text-muted)]">默认10万美元，用于仓位规则计算</p>
          </div>
          <div>
            <label className="block text-sm font-medium">使用的策略 <span className="text-[var(--text-muted)]">（可选）</span></label>
            <textarea
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="如：突破20日均线买入，跌破10日均线卖出"
              className="mt-2 w-full resize-none rounded-xl border border-[var(--border-strong)] px-4 py-3 text-sm outline-none focus:border-[var(--text)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">特别想分析的问题 <span className="text-[var(--text-muted)]">（可选）</span></label>
            <textarea
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="如：为什么7月连续亏损？我的止损策略有效吗？"
              className="mt-2 w-full resize-none rounded-xl border border-[var(--border-strong)] px-4 py-3 text-sm outline-none focus:border-[var(--text)]"
            />
          </div>
        </div>

        {trades.trim() ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">交易统计</p>
              <p className="text-xs text-[var(--text-muted)]">
                {statsSource === "ai"
                  ? "AI结构化解析结果"
                  : statsSource === "fallback"
                    ? "AI解析失败，已回退本地规则"
                    : "提交后将先由AI结构化解析"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="总笔数" value={String(tradeStats.totalTrades)} />
              <StatCard
                label="胜率"
                value={tradeStats.winRate != null ? `${tradeStats.winRate.toFixed(1)}%` : "—"}
              />
              <StatCard
                label="总盈亏"
                value={formatPnl(tradeStats.totalPnl, tradeStats.totalTrades > 0)}
                tone={tradeStats.totalPnl > 0 ? "positive" : tradeStats.totalPnl < 0 ? "negative" : "neutral"}
              />
              <StatCard
                label="盈亏比"
                value={tradeStats.profitLossRatio === Number.POSITIVE_INFINITY
                  ? "∞"
                  : tradeStats.profitLossRatio != null
                    ? tradeStats.profitLossRatio.toFixed(2)
                    : "—"}
              />
            </div>
            {/* 盈亏可视化 */}
            {tradeStats.totalTrades > 0 && tradeStats.closedPnls && tradeStats.closedPnls.length > 0 && (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h4 className="mb-3 text-sm font-semibold text-[var(--text-muted)]">逐笔盈亏</h4>
                <div className="flex items-end gap-1" style={{ height: "120px" }}>
                  {tradeStats.closedPnls.map((pnl, i) => {
                    const maxAbs = Math.max(...tradeStats.closedPnls.map(Math.abs), 1);
                    const h = Math.max(2, (Math.abs(pnl) / maxAbs) * 100);
                    const isWin = pnl >= 0;
                    return (
                      <div key={i} className="group relative flex flex-1 flex-col items-center justify-end" style={{ height: "100%" }}>
                        <div
                          className="w-full rounded-t transition-opacity hover:opacity-100"
                          style={{
                            height: `${h}%`,
                            background: isWin ? "var(--positive)" : "var(--negative)",
                            opacity: 0.7,
                            minHeight: "2px",
                          }}
                        />
                        <div className="pointer-events-none absolute -top-8 hidden whitespace-nowrap rounded bg-[var(--surface)] px-2 py-1 text-xs shadow group-hover:block">
                          #{i + 1}: {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between text-xs text-[var(--text-muted)]">
                  <span>第1笔</span>
                  <span>第{tradeStats.closedPnls.length}笔</span>
                </div>
                <div className="mt-1 flex gap-4 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "var(--positive)" }}></span>
                    盈利 {tradeStats.closedPnls.filter(p => p >= 0).length}笔
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "var(--negative)" }}></span>
                    亏损 {tradeStats.closedPnls.filter(p => p < 0).length}笔
                  </span>
                </div>
              </div>
            )}
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">仓位规则检查</p>
                <p className={`text-sm font-semibold ${positionCheck.violationCount > 0 ? "text-[var(--negative)]" : "text-[var(--positive)]"}`}>
                  总交易 {positionCheck.totalTrades} 笔 · 违规 {positionCheck.violationCount} 笔
                </p>
              </div>
              {positionCheck.violations.length > 0 ? (
                <ul className="mt-2 space-y-1.5 text-xs text-[var(--negative)]">
                  {positionCheck.violations.map((violation) => (
                    <li key={`${violation.tradeNumber}-${violation.symbol}-${violation.rule}`}>
                      ⚠️ 第{violation.tradeNumber}笔 {violation.symbol}：{violation.rule}，交易金额
                      ${violation.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}（总资金{(violation.ratio * 100).toFixed(1)}%）
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  {positionCheck.totalTrades > 0 ? "未发现可确定的仓位违规；正式报告将继续复核期权和日内交易。" : "录入可解析的数量和价格后显示检查结果。"}
                </p>
              )}
            </div>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || !trades.trim()}
          className="rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? progressStep : "开始复盘分析"}
        </button>
      </form>

      {error ? <div className="mt-4 flex items-center gap-3"><p className="rounded-lg bg-[var(--negative-bg)] px-4 py-2.5 text-sm text-[var(--negative)]">{error}</p><button onClick={() => setError("")} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-muted)]">重试</button></div> : null}

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text)]" />
          {progressStep}
        </div>
      ) : null}

      {analysis ? (
        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold">复盘报告</h3>
            <button
              onClick={() => {
                navigator.clipboard.writeText(analysis);
              }}
              className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              复制
            </button>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--text)]">{analysis}</div>
        </div>
      ) : null}

      {/* 历史复盘 */}
      {showHistory ? (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">历史复盘 ({history.length})</h3>
            <div className="flex gap-2">
              <button
                onClick={() => void generateSummary("week")}
                disabled={summaryLoading}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] disabled:opacity-40"
              >
                {summaryLoading && summaryPeriod === "week" ? "生成中…" : "本周摘要"}
              </button>
              <button
                onClick={() => void generateSummary("month")}
                disabled={summaryLoading}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] disabled:opacity-40"
              >
                {summaryLoading && summaryPeriod === "month" ? "生成中…" : "本月摘要"}
              </button>
            </div>
          </div>
          {summaryError ? <p className="mb-3 rounded-lg bg-[var(--negative-bg)] px-4 py-2.5 text-sm text-[var(--negative)]">{summaryError}</p> : null}
          {summary ? (
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{summaryPeriod === "week" ? "本周复盘摘要" : "本月复盘摘要"}</p>
                <button onClick={exportSummaryMarkdown} className="text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]">导出Markdown</button>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--text)]">{summary}</div>
            </div>
          ) : null}
          {history.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">还没有历史记录</p>
          ) : (
            <div className="space-y-2">
              {history.map((r) => (
                <details key={r.id} className="group rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.trades.slice(0, 50).replace(/\n/g, " ")}…</p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {new Date(r.date).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}
                        {r.strategy ? ` · ${r.strategy.slice(0, 30)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-lg font-light text-[var(--text-muted)] transition-transform group-open:rotate-45">＋</span>
                    </div>
                  </summary>
                  <div className="border-t border-[var(--border)] px-4 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs text-[var(--text-muted)]">交易记录</p>
                      <button
                        onClick={() => deleteReview(r.id)}
                        className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--negative)]"
                      >
                        删除
                      </button>
                    </div>
                    <pre className="mb-3 whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">{r.trades}</pre>
                    <div className="rounded-lg bg-[var(--surface-subtle)] p-3">
                      <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--text)]">{r.analysis}</div>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <p className="mt-10 text-xs text-[var(--text-muted)]">本工具仅供研究参考，不构成投资建议。历史记录保存在本地浏览器。</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const valueColor = tone === "positive"
    ? "text-[var(--positive)]"
    : tone === "negative"
      ? "text-[var(--negative)]"
      : "text-[var(--text)]";

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}
