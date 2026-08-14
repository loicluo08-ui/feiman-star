"use client";

import { FormEvent, useState } from "react";

type ReviewRecord = {
  id: string;
  date: string;
  trades: string;
  strategy: string;
  questions: string;
  analysis: string;
};

const STORAGE_KEY = "feimanstar_reviews";

export default function ReviewPage() {
  const [trades, setTrades] = useState("");
  const [strategy, setStrategy] = useState("");
  const [questions, setQuestions] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ReviewRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

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
      const result = json.data?.analysis ?? "";
      setAnalysis(result);

      // 保存到历史
      if (result) {
        const record: ReviewRecord = {
          id: `${Date.now()}`,
          date: new Date().toISOString(),
          trades: trades.slice(0, 200),
          strategy: strategy.slice(0, 100),
          questions: questions.slice(0, 100),
          analysis: result,
        };
        saveReview(record);
      }
    } catch {
      setError("AI分析暂时不可用，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  const exampleTrades = `示例格式（直接粘贴你的交易记录即可）：

2024-07-15 买入 AAPL 100股 @ $185.00
2024-07-22 卖出 AAPL 100股 @ $187.50
2024-07-20 买入 TSLA 50股 @ $248.00
2024-08-01 卖出 TSLA 50股 @ $235.00  止损出局`;

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
          <label className="block text-sm font-medium">交易记录 <span className="text-red-500">*</span></label>
          <p className="mt-1 text-xs text-[#8e8e93]">支持任意格式，只要AI能读懂。每笔交易一行：日期、方向、代码、数量、价格</p>
          <textarea
            value={trades}
            onChange={(e) => setTrades(e.target.value)}
            rows={8}
            maxLength={8000}
            placeholder={exampleTrades}
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

        <button
          type="submit"
          disabled={loading || !trades.trim()}
          className="rounded-xl bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "AI分析中，约15-30秒…" : "开始复盘分析"}
        </button>
      </form>

      {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p> : null}

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-[#8e8e93]">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#e5e5e7] border-t-[#1a1a1a]" />
          正在分析交易记录…
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
