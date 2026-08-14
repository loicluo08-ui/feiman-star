"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getTask, startTask, type BackgroundTask } from "@/lib/background-task";

type ReviewRecord = {
  id: string;
  date: string;
  trades: string;
  strategy: string;
  questions: string;
  analysis: string;
};

type ReviewAnalysisResult = {
  analysis: string;
  trades: string;
  strategy: string;
  questions: string;
  record: ReviewRecord;
  tradeStats: TradeStats;
  parseMode: "ai" | "fallback";
};

const STORAGE_KEY = "feimanstar_reviews";
const REVIEW_TASK_KEY = "review-analysis";
const REVIEW_DRAFT_KEY = "feimanstar_review_draft";

type ReviewDraft = {
  trades: string;
  strategy: string;
  questions: string;
};

function readReviewDraft(): ReviewDraft | null {
  try {
    const saved = localStorage.getItem(REVIEW_DRAFT_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Partial<ReviewDraft>;
    if (
      typeof parsed.trades !== "string"
      || typeof parsed.strategy !== "string"
      || typeof parsed.questions !== "string"
    ) {
      return null;
    }
    return parsed as ReviewDraft;
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
};

type TradeStats = {
  totalTrades: number;
  winRate: number | null;
  totalPnl: number;
  profitLossRatio: number | null;
};

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
  };
}

function calculateTradeStats(text: string): TradeStats {
  return calculateTradeStatsFromEntries(parseTrades(text), text);
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
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ReviewRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [resolvedTradeStats, setResolvedTradeStats] = useState<TradeStats | null>(null);
  const [statsSource, setStatsSource] = useState<"local" | "ai" | "fallback">("local");
  const [progressStep, setProgressStep] = useState("正在解析交易记录…");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const mountedRef = useRef(false);
  const localTradeStats = useMemo(() => calculateTradeStats(trades), [trades]);
  const tradeStats = resolvedTradeStats ?? localTradeStats;

  useEffect(() => {
    mountedRef.current = true;
    const draft = readReviewDraft();
    if (draft) {
      setTrades(draft.trades);
      setStrategy(draft.strategy);
      setQuestions(draft.questions);
    }
    setDraftHydrated(true);
    const task = getTask<ReviewAnalysisResult>(REVIEW_TASK_KEY);

    const applyResult = (result: ReviewAnalysisResult) => {
      if (!mountedRef.current) return;
      setTrades(result.trades);
      setStrategy(result.strategy);
      setQuestions(result.questions);
      setAnalysis(result.analysis);
      setResolvedTradeStats(result.tradeStats);
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
      setError("AI分析暂时不可用，请稍后重试");
    } else if (task?.status === "running") {
      setLoading(true);
      setProgressStep("AI处理中…");
      void task.promise.then(applyResult).catch(() => {
        if (!mountedRef.current) return;
        setLoading(false);
        setError("AI分析暂时不可用，请稍后重试");
      });
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    try {
      localStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({ trades, strategy, questions }));
    } catch {
      // localStorage不可用时不影响复盘分析。
    }
  }, [draftHydrated, questions, strategy, trades]);

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
    setLoading(true);
    setProgressStep("正在用AI解析交易记录…");
    setError("");
    setAnalysis("");
    setResolvedTradeStats(null);
    setStatsSource("local");

    const task: BackgroundTask<ReviewAnalysisResult> = startTask(REVIEW_TASK_KEY, async () => {
      let parsedStats: TradeStats;
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
        parseMode = "ai";
        if (mountedRef.current) {
          setResolvedTradeStats(parsedStats);
          setStatsSource("ai");
          setProgressStep("交易解析完成，正在生成复盘报告…");
        }
      } catch {
        parsedStats = calculateTradeStats(currentTrades);
        if (mountedRef.current) {
          setResolvedTradeStats(parsedStats);
          setStatsSource("fallback");
          setProgressStep("AI解析失败，已用本地规则解析；正在生成复盘报告…");
        }
      }

      const res = await fetch("/api/invest/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trades: currentTrades,
          strategy: currentStrategy,
          questions: currentQuestions,
        }),
      });
      if (!res.ok) throw new Error("分析失败");
      const json = await res.json();
      const result = json.data?.analysis ?? "";
      const record: ReviewRecord = {
        id: `${Date.now()}`,
        date: new Date().toISOString(),
        trades: currentTrades,
        strategy: currentStrategy,
        questions: currentQuestions,
        analysis: result,
      };
      if (result) saveReview(record);

      return {
        analysis: result,
        trades: currentTrades,
        strategy: currentStrategy,
        questions: currentQuestions,
        record,
        tradeStats: parsedStats,
        parseMode,
      };
    });

    void task.promise.then((result) => {
      if (!mountedRef.current) return;
      setAnalysis(result.analysis);
      setResolvedTradeStats(result.tradeStats);
      setStatsSource(result.parseMode);
      setHistory((previous) => [
        result.record,
        ...previous.filter((record) => record.id !== result.record.id),
      ].slice(0, 20));
      setLoading(false);
    }).catch(() => {
      if (!mountedRef.current) return;
      setError("AI分析暂时不可用，请稍后重试");
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
          <p className="mt-2 text-sm text-[#6e6e73]">粘贴交易记录，AI做归因分析——盈亏来源、行为偏差、改进建议</p>
        </div>
        <button
          onClick={loadHistory}
          className="shrink-0 rounded-lg border border-[#e5e5e7] px-3 py-2 text-xs font-medium text-[#6e6e73] transition-colors hover:border-[#1a1a1a]"
        >
          历史复盘
        </button>
      </header>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">交易记录 <span className="text-red-500">*</span></label>
            <div className="flex gap-1.5">
              {templates.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => {
                    setTrades(t.content);
                    setResolvedTradeStats(null);
                    setStatsSource("local");
                  }}
                  className="rounded-md bg-[#f2f2f3] px-2 py-1 text-xs text-[#6e6e73] transition-colors hover:bg-[#e5e5e7]"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-xs text-[#8e8e93]">支持任意格式，只要AI能读懂。每笔交易一行：日期、方向、代码、数量、价格</p>
          <textarea
            value={trades}
            onChange={(e) => {
              setTrades(e.target.value);
              setResolvedTradeStats(null);
              setStatsSource("local");
            }}
            rows={8}
            maxLength={8000}
            placeholder="点击上方模板按钮快速填充，或直接粘贴你的交易记录"
            className="mt-2 w-full resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 font-mono text-xs leading-6 outline-none focus:border-[#1a1a1a]"
          />
          <div className="mt-1 flex justify-between text-xs text-[#8e8e93]">
            <span>支持中英文、任意分隔符</span>
            <span>{trades.length}/8000</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">使用的策略 <span className="text-[#8e8e93]">（可选）</span></label>
            <textarea
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="如：突破20日均线买入，跌破10日均线卖出"
              className="mt-2 w-full resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none focus:border-[#1a1a1a]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">特别想分析的问题 <span className="text-[#8e8e93]">（可选）</span></label>
            <textarea
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="如：为什么7月连续亏损？我的止损策略有效吗？"
              className="mt-2 w-full resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none focus:border-[#1a1a1a]"
            />
          </div>
        </div>

        {trades.trim() ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">交易统计</p>
              <p className="text-xs text-[#8e8e93]">
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
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || !trades.trim()}
          className="rounded-xl bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? progressStep : "开始复盘分析"}
        </button>
      </form>

      {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p> : null}

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-[#8e8e93]">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#e5e5e7] border-t-[#1a1a1a]" />
          {progressStep}
        </div>
      ) : null}

      {analysis ? (
        <div className="mt-6 rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold">复盘报告</h3>
            <button
              onClick={() => {
                navigator.clipboard.writeText(analysis);
              }}
              className="text-xs text-[#8e8e93] transition-colors hover:text-[#1a1a1a]"
            >
              复制
            </button>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-7 text-[#1a1a1a]">{analysis}</div>
        </div>
      ) : null}

      {/* 历史复盘 */}
      {showHistory ? (
        <div className="mt-8">
          <h3 className="mb-3 text-base font-semibold">历史复盘 ({history.length})</h3>
          {history.length === 0 ? (
            <p className="text-sm text-[#8e8e93]">还没有历史记录</p>
          ) : (
            <div className="space-y-2">
              {history.map((r) => (
                <details key={r.id} className="group rounded-xl border border-[#e5e5e7] bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.trades.slice(0, 50).replace(/\n/g, " ")}…</p>
                      <p className="mt-0.5 text-xs text-[#8e8e93]">
                        {new Date(r.date).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}
                        {r.strategy ? ` · ${r.strategy.slice(0, 30)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-lg font-light text-[#8e8e93] transition-transform group-open:rotate-45">＋</span>
                    </div>
                  </summary>
                  <div className="border-t border-[#e5e5e7] px-4 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs text-[#8e8e93]">交易记录</p>
                      <button
                        onClick={() => deleteReview(r.id)}
                        className="text-xs text-[#8e8e93] transition-colors hover:text-red-600"
                      >
                        删除
                      </button>
                    </div>
                    <pre className="mb-3 whitespace-pre-wrap text-xs leading-5 text-[#6e6e73]">{r.trades}</pre>
                    <div className="rounded-lg bg-[#f7f7f8] p-3">
                      <div className="whitespace-pre-wrap text-sm leading-7 text-[#1a1a1a]">{r.analysis}</div>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <p className="mt-10 text-xs text-[#8e8e93]">本工具仅供研究参考，不构成投资建议。历史记录保存在本地浏览器。</p>
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
    ? "text-[#16a34a]"
    : tone === "negative"
      ? "text-[#dc2626]"
      : "text-[#1a1a1a]";

  return (
    <div className="rounded-xl border border-[#e5e5e7] bg-white px-4 py-3">
      <p className="text-xs text-[#8e8e93]">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}
