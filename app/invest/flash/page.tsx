"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface FlashItem {
  id: string;
  title: string;
  content: string;
  content_text: string;
  time: number;
  time_str: string;
  channels: string[];
  is_important: boolean;
  symbols?: string[];
}

type Filter = "all" | "important" | "global" | "a-stock";

export default function FlashPage() {
  const [items, setItems] = useState<FlashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());

  const fetchFlash = useCallback(async () => {
    try {
      const res = await fetch("/api/invest/flash", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("fetch_failed");
      }
      const data = await res.json();
      const newItems: FlashItem[] = data.data || [];

      // 检测新消息
      if (prevIdsRef.current.size > 0) {
        const newOnes = newItems.filter((item) => !prevIdsRef.current.has(item.id));
        if (newOnes.length > 0) {
          setNewIds(new Set(newOnes.map((i) => i.id)));
          setTimeout(() => setNewIds(new Set()), 5000);
        }
      }
      prevIdsRef.current = new Set(newItems.map((i) => i.id));

      setItems(newItems);
      setError(null);
    } catch {
      setError("快讯暂时不可用，稍后自动重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlash();
  }, [fetchFlash]);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(fetchFlash, 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, fetchFlash]);

  const filtered = items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "important") return item.is_important;
    if (filter === "global") return item.channels.includes("全球");
    if (filter === "a-stock") return item.channels.includes("A股");
    return true;
  });

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">实时快讯</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            华尔街见闻·全球+A股 · 30秒自动刷新
          </p>
        </div>
        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            autoRefresh
              ? "border-[var(--positive)] text-[var(--positive)]"
              : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          {autoRefresh ? "● 自动刷新中" : "○ 已暂停"}
        </button>
      </header>

      {/* Filter */}
      <div className="mb-4 flex gap-2">
        {([
          { key: "all", label: "全部" },
          { key: "important", label: "重要" },
          { key: "global", label: "全球" },
          { key: "a-stock", label: "A股" },
        ] as Array<{ key: Filter; label: string }>).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === tab.key
                ? "bg-[var(--text)] text-[var(--bg)]"
                : "bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="py-20 text-center text-sm text-[var(--text-muted)]">加载中...</div>
      ) : error ? (
        <div className="py-20 text-center text-sm text-[var(--text-muted)]">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-sm text-[var(--text-muted)]">暂无快讯</div>
      ) : (
        <div className="space-y-1">
          {filtered.map((item) => {
            const isNew = newIds.has(item.id);
            return (
              <article
                key={item.id}
                className={`rounded-xl border p-4 transition-all ${
                  isNew
                    ? "border-[var(--positive)] bg-[var(--positive)]/5"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                {/* Meta */}
                <div className="mb-1.5 flex items-center gap-2 text-xs">
                  {item.is_important && (
                    <span className="rounded bg-[var(--warning)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                      重要
                    </span>
                  )}
                  {item.channels.map((ch) => (
                    <span
                      key={ch}
                      className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]"
                    >
                      {ch}
                    </span>
                  ))}
                  <span className="text-[var(--text-muted)]">{item.time_str}</span>
                  {isNew && (
                    <span className="text-[var(--positive)]">● 新</span>
                  )}
                </div>

                {/* Title */}
                {item.title && item.title !== item.content_text.slice(0, 30) && (
                  <h3 className="mb-1 text-sm font-semibold text-[var(--text)]">{item.title}</h3>
                )}

                {/* Content */}
                <p className="text-sm leading-6 text-[var(--text-secondary)]">
                  {item.content_text}
                </p>

                {/* Symbols */}
                {item.symbols && item.symbols.length > 0 && (
                  <div className="mt-2 flex gap-1.5">
                    {item.symbols.slice(0, 5).map((sym) => (
                      <span
                        key={sym}
                        className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]"
                      >
                        {sym}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <footer className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
        <p className="text-xs leading-5 text-[var(--text-muted)]">
          快讯来源：华尔街见闻。数据可能有数秒延迟，仅供研究参考，不构成投资建议。
        </p>
      </footer>
    </div>
  );
}
